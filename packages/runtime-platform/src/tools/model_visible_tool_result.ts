import { cap_model_visible_tool_text, cap_strings_in_tool_payload } from '@coworker/shared';

const catalog_node_payload_keys = ['output', 'app_name', 'node_key', 'node_name'] as const;

const catalog_node_output_noise_keys = ['verification', 'stash_id', 'observations'] as const;

type CatalogNodeResultEnvelope = Record<string, unknown> & {
  output?: unknown;
};

type CatalogNodeOutput = Record<string, unknown> & {
  exports?: unknown;
  ret?: unknown;
};

export function stringify_model_visible_tool_result(data: unknown) {
  const payload = cap_strings_in_tool_payload(project_model_visible_tool_payload(data));
  return cap_model_visible_tool_text(JSON.stringify(payload) ?? String(payload));
}

export function project_model_visible_tool_payload(data: unknown) {
  if (!is_catalog_node_result_envelope(data)) return data;
  if (!has_only_keys(data, [...catalog_node_payload_keys, ...catalog_node_output_noise_keys])) {
    return data;
  }

  if (!is_catalog_node_output(data.output)) return data.output ?? data;

  const exports_record = is_catalog_node_exports(data.output.exports) ? data.output.exports : null;
  const summary = typeof exports_record?.$summary === 'string' ? exports_record.$summary : null;
  const other_exports = exports_record ? drop_keys(exports_record, ['$summary']) : {};
  const returned = drop_keys(data.output, ['exports', ...catalog_node_output_noise_keys]);
  const stash_id = read_stash_id(data, data.output);

  return {
    ...(summary === null ? {} : { summary }),
    ...other_exports,
    ...hoist_returned_value(returned),
    ...(stash_id === null ? {} : { stash_id }),
  };
}

function read_stash_id(
  record: Record<string, unknown>,
  node_output: Record<string, unknown>,
): string | null {
  const value = node_output.stash_id ?? record.stash_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function hoist_returned_value(returned: Record<string, unknown>) {
  const keys = Object.keys(returned);
  if (keys.length !== 1 || keys[0] !== 'ret') return returned;

  const value = returned.ret;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}

function has_only_keys(record: Record<string, unknown>, allowed: readonly string[]) {
  const allowed_keys = new Set<string>(allowed);
  return Object.keys(record).every((key) => allowed_keys.has(key));
}

function drop_keys(record: Record<string, unknown>, dropped: readonly string[]) {
  const dropped_keys = new Set<string>(dropped);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !dropped_keys.has(key)));
}

function is_catalog_node_result_envelope(value: unknown): value is CatalogNodeResultEnvelope {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function is_catalog_node_output(value: unknown): value is CatalogNodeOutput {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function is_catalog_node_exports(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
