import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { check_relationships } from '@connectors/sync_definition/check_relationships';
import {
  check_sync_directory,
  check_sync_file_fetch,
} from '@connectors/sync_definition/check_sync_directory';
import {
  line_schema,
  text_resolvers_schema,
} from '@connectors/sync_definition/sync_extension_schemas';
import { is_read_content } from '@connectors/sync_definition/sync_object_schema';
import type { ConnectorSyncDimension, ConnectorSyncObject } from '@connectors/sync_types';
import type { ConnectorApp } from '@connectors/types';
import { evaluate_value_expression, is_plain_record } from '@connectors/value_expression';
import { format_error_message } from '@coworker/shared';

export const browse_request_scope_fields = ['parent_id', 'query', 'cursor'] as const;
const person_render_fields = new Set(['display_name', 'external_person_id', 'email']);

export function check_sync_extensions(app: ConnectorApp, source_path: string): readonly string[] {
  const warnings: string[] = [];
  for (const dimension of app.sync?.dimensions ?? []) {
    const where = `${source_path}: sync dimension ${dimension.key}`;
    check_browse_request(dimension, where);
    check_selection_includes_descendants(dimension, where);
  }
  check_sync_directory(app, source_path);
  check_sync_file_fetch(app, source_path);
  for (const [object_key, object] of Object.entries(app.sync?.objects ?? {})) {
    const where = `${source_path}: sync object ${object_key}`;
    check_text_resolvers(app, object, where);
    check_line(object, where);
    warnings.push(...check_relationships(app, object, where));
    check_files(app, object, where);
  }
  return warnings;
}

export function list_template_placeholders(template: string): string[] {
  return [...template.matchAll(/\{([^{}]+)\}/gu)].map((match) => (match[1] ?? '').trim());
}

function collect_browse_request_roots(expression: unknown): string[] {
  const roots: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      for (const placeholder of list_template_placeholders(value)) {
        roots.push(placeholder.split('.')[0] ?? '');
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (!is_plain_record(value)) return;
    const record = value;
    if ('$literal' in record) return;
    if (typeof record.$ === 'string') {
      roots.push(record.$.split('.')[0] ?? '');
      return;
    }
    for (const entry of Object.values(record)) walk(entry);
  };
  walk(expression);
  return roots;
}

function check_browse_request(dimension: ConnectorSyncDimension, where: string) {
  if (dimension.browse_request === undefined) return;
  if (!dimension.browse_node) {
    throw new Error(`${where} declares browse_request, but no browse_node to shape input for.`);
  }
  const legal_roots = new Set<string>(browse_request_scope_fields);
  for (const root of collect_browse_request_roots(dimension.browse_request)) {
    if (legal_roots.has(root)) continue;
    throw new Error(
      `${where} browse_request reads ${root}, which is not a picker field ` +
        `(${browse_request_scope_fields.join(', ')}).`,
    );
  }
  try {
    evaluate_value_expression(dimension.browse_request, {
      parent_id: 'probe',
      query: 'probe',
      cursor: 'probe',
    });
  } catch (error) {
    throw new Error(
      `${where} holds a malformed browse_request expression: ${format_error_message(error)}`,
    );
  }
}

function check_selection_includes_descendants(dimension: ConnectorSyncDimension, where: string) {
  if (dimension.selection_includes_descendants === undefined) return;
  if (dimension.shape !== 'tree') {
    throw new Error(
      `${where} declares selection_includes_descendants, which only a tree dimension has a subtree for.`,
    );
  }
  if (!dimension.browse_node) {
    throw new Error(
      `${where} declares selection_includes_descendants, but no browse_node to list descendants with.`,
    );
  }
}

function check_files(app: ConnectorApp, object: ConnectorSyncObject, where: string) {
  if (object.file_fetch_input === undefined) return;
  if (object.files === undefined) {
    throw new Error(`${where} declares file_fetch_input, but no files expression to fetch.`);
  }
  if (!app.sync?.file_fetch?.node) {
    throw new Error(
      `${where} declares file_fetch_input, but the app's sync.file_fetch names no node to feed it to.`,
    );
  }
}

function check_text_resolvers(app: ConnectorApp, object: ConnectorSyncObject, where: string) {
  if (object.text_resolvers === undefined) return;
  const violation = find_json_schema_violation(
    text_resolvers_schema(),
    object.text_resolvers,
    'text_resolvers',
  );
  if (violation) throw new Error(`${where} has invalid text_resolvers: ${violation}`);
  for (const resolver of object.text_resolvers) {
    check_one_text_resolver(app, resolver, where);
  }
}

function check_one_text_resolver(
  app: ConnectorApp,
  resolver: { pattern: string; lookup?: 'person'; render: string },
  where: string,
) {
  let group_count: number;
  try {
    const probe = new RegExp(`${resolver.pattern}|`).exec('');
    group_count = (probe?.length ?? 1) - 1;
  } catch (error) {
    throw new Error(
      `${where} has a text resolver pattern that does not compile: ${format_error_message(error)}`,
    );
  }
  if (group_count < 1) {
    throw new Error(
      `${where} has a text resolver pattern with no capture group: ${resolver.pattern}`,
    );
  }
  if (resolver.lookup === 'person' && !app.sync?.directory) {
    throw new Error(
      `${where} has a person lookup resolver, but the app declares no sync directory to resolve against.`,
    );
  }
  for (const placeholder of resolver.render.matchAll(/\{([^{}]+)\}/gu)) {
    const name = placeholder[1] ?? '';
    if (/^[0-9]+$/.test(name)) {
      const group = Number(name);
      if (group >= 1 && group <= group_count) continue;
      throw new Error(
        `${where} has a text resolver render naming group {${name}}, but the pattern captures ${group_count}.`,
      );
    }
    if (resolver.lookup === 'person' && person_render_fields.has(name)) continue;
    throw new Error(`${where} has a text resolver render with an unknown field: {${name}}`);
  }
}

function check_line(object: ConnectorSyncObject, where: string) {
  if (object.line === undefined) return;
  const violation = find_json_schema_violation(line_schema(), object.line, 'line');
  if (violation) throw new Error(`${where} has an invalid line: ${violation}`);
  if (!object.bucket) {
    throw new Error(`${where} declares line, which only a bucketed object renders.`);
  }
  if (object.line.text !== undefined && !is_read_content(object.content)) {
    throw new Error(`${where} sets line.text, which only read_node content evaluates.`);
  }
}
