import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { check_sync_extensions } from '@connectors/sync_definition/check_sync_extensions';
import {
  is_read_content,
  is_scope_day_of,
  read_content_schema,
} from '@connectors/sync_definition/sync_object_schema';
import type { ConnectorSyncObject } from '@connectors/sync_types';
import type { ConnectorApp } from '@connectors/types';
import { evaluate_value_expression } from '@connectors/value_expression';
import { format_error_message } from '@coworker/shared';

const empty_expression_scope = { item: {}, scope: {}, response: {} };

function list_object_expressions(object: ConnectorSyncObject): unknown[] {
  return [
    object.page.items,
    object.page.next_cursor,
    object.page.error,
    object.when,
    object.files,
    ...Object.values(object.file_fetch_input ?? {}),
    object.cursor?.field,
    object.identity,
    object.version_signal,
    object.tombstone,
    object.title,
    is_read_content(object.content) ? object.content.text : object.content,
    ...(is_read_content(object.content) ? Object.values(object.content.input) : []),
    object.container?.id,
    object.container?.path,
    object.source_url,
    ...Object.values(object.metadata ?? {}),
    object.bucket?.by === 'day' ? object.bucket.of : object.bucket?.key,
    ...Object.values(object.relationships ?? {}).map((value) =>
      is_scope_day_of(value) ? value.scope_day_of : value,
    ),
    object.line?.author,
    object.line?.time,
    object.line?.text,
  ].filter((expression) => expression !== undefined);
}

export function check_sync_objects(app: ConnectorApp, source_path: string) {
  const dimension_keys = new Set(app.sync?.dimensions.map((dimension) => dimension.key) ?? []);
  check_sync_extensions(app, source_path);
  for (const [object_key, object] of Object.entries(app.sync?.objects ?? {})) {
    const where = `${source_path}: sync object ${object_key}`;
    check_scoped_by(object, dimension_keys, where);
    check_strategy(object, where);
    check_read_content(object, where);
    for (const expression of list_object_expressions(object)) {
      try {
        evaluate_value_expression(expression, empty_expression_scope);
      } catch (error) {
        throw new Error(
          `${where} holds a malformed value expression: ${format_error_message(error)}`,
        );
      }
    }
  }
}

function check_read_content(object: ConnectorSyncObject, where: string) {
  if (!is_read_content(object.content)) return;
  const violation = find_json_schema_violation(read_content_schema, object.content, 'content');
  if (violation) throw new Error(`${where} has an invalid read_node content: ${violation}`);
}

function check_scoped_by(object: ConnectorSyncObject, dimension_keys: Set<string>, where: string) {
  for (const dimension_key of Object.keys(object.scoped_by)) {
    if (dimension_keys.has(dimension_key)) continue;
    throw new Error(`${where} is scoped by ${dimension_key}, which is not a declared dimension.`);
  }
}

function check_strategy(object: ConnectorSyncObject, where: string) {
  const needs_cursor = object.strategy !== 'relist_diff';
  if (needs_cursor && !object.cursor) {
    throw new Error(`${where} uses ${object.strategy}, which needs a cursor.`);
  }
  if (!needs_cursor && object.cursor) {
    throw new Error(`${where} uses relist_diff, which has no cursor to send.`);
  }
  if (object.edit_window_days !== undefined && object.strategy !== 'append_log') {
    throw new Error(`${where} sets edit_window_days, which only append_log re-reads.`);
  }
}
