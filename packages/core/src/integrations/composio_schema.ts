// Composio's JSON Schema, turned into ours. Pure: no I/O, no environment, no database. The
// catalog sync calls it at setup time and the tests call it directly.
//
// Composio ships standard JSON Schema with four house quirks:
// `human_parameter_name` / `human_parameter_description` on properties, `file_uploadable: true`
// on `{ name, mimetype, s3key }` objects, `anyOf: [X, { type: 'null' }]` for nullable, and
// `file_downloadable: true` on `{ name, mimetype, s3url }` output objects.

import type {
  ApprovalPolicyData,
  NodeInputSchemaData,
  ToolInputPropertyData,
} from '@coworker/core/db/schema/json_column_types';

export const composio_provider_key = 'composio';
export const composio_runtime_handler_prefix = 'composio.';
export const composio_proxy_runtime_handler = 'composio.api_proxy';
export const composio_trigger_runtime_handler_prefix = 'composio.trigger.';
export const composio_hosted_setup_strategy_type = 'hosted_connect_link';

export const composio_auth_method_keys = {
  managed_oauth: 'composio_managed_oauth',
  custom_auth: 'composio_custom_auth',
  none: 'none',
} as const;

export function build_composio_provider_config_key(toolkit_slug: string) {
  return `${composio_provider_key}:${toolkit_slug}`;
}

export function build_composio_connection_profile_key(toolkit_slug: string, auth_scheme: string) {
  return `${composio_provider_key}:${toolkit_slug}:${auth_scheme.toLowerCase()}`;
}

const composio_auth_types: Record<string, 'oauth2' | 'api_key' | 'none'> = {
  OAUTH2: 'oauth2',
  OAUTH1: 'oauth2',
  DCR_OAUTH: 'oauth2',
  S2S_OAUTH2: 'oauth2',
  NO_AUTH: 'none',
};

export function composio_auth_scheme_auth_type(scheme: string): 'oauth2' | 'api_key' | 'none' {
  return composio_auth_types[scheme.toUpperCase()] ?? 'api_key';
}

export function composio_approval_policy(tags: readonly string[]): ApprovalPolicyData {
  return tags.includes('readOnlyHint')
    ? { mode: 'none', reason: 'composio_read_only_hint' }
    : { mode: 'manual_review', reason: 'composio_provider_action_default' };
}

const file_reference_description =
  'Provide a workspace file path (e.g. `files/report.pdf`) or a publicly readable HTTPS URL. The file is uploaded to the provider before the tool runs.';

type JsonRecord = Record<string, unknown>;

export type ComposioToolInputSchema = NodeInputSchemaData & {
  properties: NonNullable<NodeInputSchemaData['properties']>;
};

export function translate_composio_tool_schema(
  input_parameters: Record<string, unknown>,
): ComposioToolInputSchema {
  const root = translate_schema_node(input_parameters);
  if (root.type !== 'object' || !is_schema_node(root.properties)) {
    return { type: 'object', properties: {} };
  }

  return {
    ...root,
    type: 'object',
    properties: root.properties as Record<string, ToolInputPropertyData>,
  } as ComposioToolInputSchema;
}

export function translate_composio_output_schema(
  output_parameters: Record<string, unknown>,
): Record<string, unknown> {
  return { ...output_parameters };
}

export function list_composio_file_output_paths(output_schema: unknown): string[][] {
  const paths: string[][] = [];
  collect_file_output_paths(output_schema, [], paths);
  return paths;
}

function collect_file_output_paths(node: unknown, path: string[], paths: string[][]) {
  if (!is_schema_node(node)) return;
  if (node.file_downloadable === true) {
    paths.push(path);
    return;
  }
  for (const branch of read_composition_branches(node)) {
    collect_file_output_paths(branch, path, paths);
  }
  if (is_schema_node(node.properties)) {
    for (const [name, property] of Object.entries(node.properties)) {
      collect_file_output_paths(property, [...path, name], paths);
    }
  }
  if (is_schema_node(node.items)) collect_file_output_paths(node.items, [...path, '[]'], paths);
}

const schema_node_transforms: ReadonlyArray<(node: JsonRecord) => JsonRecord> = [
  collapse_nullable_any_of,
  fold_human_parameter_name,
  fold_human_parameter_description,
];

function translate_schema_node(node: Record<string, unknown>): JsonRecord {
  const normalized = schema_node_transforms.reduce<JsonRecord>(
    (current, transform) => transform(current),
    { ...node },
  );

  const file_property = translate_file_uploadable(normalized);
  if (file_property) return file_property;

  return translate_child_schemas(normalized);
}

function translate_child_schemas(node: JsonRecord): JsonRecord {
  const result: JsonRecord = { ...node };
  if (is_schema_node(node.properties)) result.properties = translate_schema_map(node.properties);
  if (is_schema_node(node.$defs)) result.$defs = translate_schema_map(node.$defs);
  if (is_schema_node(node.items)) result.items = translate_schema_node(node.items);
  if (is_schema_node(node.additionalProperties)) {
    result.additionalProperties = translate_schema_node(node.additionalProperties);
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = node[keyword];
    if (!Array.isArray(branches)) continue;
    result[keyword] = branches.map((branch) =>
      is_schema_node(branch) ? translate_schema_node(branch) : branch,
    );
  }
  return result;
}

function translate_schema_map(entries: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      name,
      is_schema_node(value) ? translate_schema_node(value) : value,
    ]),
  );
}

function collapse_nullable_any_of(node: JsonRecord): JsonRecord {
  const branches = node.anyOf;
  if (!Array.isArray(branches)) return node;

  const value_branches = branches.filter(
    (branch) => !(is_schema_node(branch) && branch.type === 'null'),
  );
  if (value_branches.length !== 1 || value_branches.length === branches.length) return node;

  const [value_branch] = value_branches;
  if (!is_schema_node(value_branch)) return node;

  const { anyOf: _removed, ...rest } = node;
  return { ...value_branch, ...rest };
}

function fold_human_parameter_name(node: JsonRecord): JsonRecord {
  const { human_parameter_name, ...rest } = node;
  if (typeof human_parameter_name !== 'string' || !human_parameter_name.trim()) return rest;
  return typeof rest.title === 'string' && rest.title.trim()
    ? rest
    : { ...rest, title: human_parameter_name };
}

function fold_human_parameter_description(node: JsonRecord): JsonRecord {
  const { human_parameter_description, ...rest } = node;
  if (typeof human_parameter_description !== 'string' || !human_parameter_description.trim()) {
    return rest;
  }
  const description = typeof rest.description === 'string' ? rest.description : '';
  return human_parameter_description.length > description.length
    ? { ...rest, description: human_parameter_description }
    : rest;
}

function translate_file_uploadable(node: JsonRecord): JsonRecord | null {
  const shape = read_file_uploadable_shape(node);
  if (!shape) return null;

  const description = compose_file_description(node.description);
  const item: ToolInputPropertyData = {
    type: 'string',
    description,
    field: { file_reference: { accepted_sources: ['workspace_path', 'url'] } },
  };

  return shape === 'many'
    ? { ...read_carried_keywords(node), type: 'array', description, items: item }
    : { ...read_carried_keywords(node), ...item };
}

// `plain` for one file object, `many` for an array of them (directly, or as an `anyOf` branch —
// Composio wraps "one or many" that way).
function read_file_uploadable_shape(node: JsonRecord): 'plain' | 'many' | null {
  if (node.file_uploadable === true) return 'plain';
  if (is_schema_node(node.items) && node.items.file_uploadable === true) return 'many';

  const branches = read_composition_branches(node);
  if (branches.length === 0) return null;

  const shapes = branches
    .map((branch) => read_file_uploadable_shape(branch))
    .filter((shape): shape is 'plain' | 'many' => shape !== null);
  if (shapes.length === 0) return null;
  return shapes.includes('many') ? 'many' : 'plain';
}

function read_composition_branches(node: JsonRecord): JsonRecord[] {
  return (['anyOf', 'oneOf', 'allOf'] as const)
    .flatMap((keyword) => (Array.isArray(node[keyword]) ? (node[keyword] as unknown[]) : []))
    .filter(is_schema_node);
}

const carried_file_keywords = ['title', 'default', 'examples', 'minItems', 'maxItems'] as const;

function read_carried_keywords(node: JsonRecord): JsonRecord {
  return Object.fromEntries(
    carried_file_keywords
      .filter((keyword) => node[keyword] !== undefined)
      .map((keyword) => [keyword, node[keyword]]),
  );
}

function compose_file_description(description: unknown) {
  const provider_description = typeof description === 'string' ? description.trim() : '';
  return provider_description
    ? `${provider_description.replace(/\s*$/u, '')} ${file_reference_description}`
    : file_reference_description;
}

function is_schema_node(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
