const tool_result_envelope_keys = [
  'success',
  'data',
  'error',
  'model_visible_data',
  'metadata',
] as const;

const catalog_node_payload_keys = ['output', 'app_name', 'node_key', 'node_name'] as const;

const catalog_node_output_noise_keys = ['verification', 'stash_id', 'observations'] as const;

export function read_tool_detail_input(input: unknown) {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    !('input' in input) ||
    typeof input.input !== 'object' ||
    input.input === null ||
    Array.isArray(input.input)
  ) {
    return input;
  }

  const node_key =
    'node_key' in input && typeof input.node_key === 'string' ? { node_key: input.node_key } : {};
  return { ...input.input, ...node_key };
}

export function read_tool_detail_output(output: unknown) {
  const payload = read_tool_result_payload(output);
  return read_catalog_node_payload(payload);
}

function read_tool_result_payload(output: unknown) {
  if (
    typeof output !== 'object' ||
    output === null ||
    Array.isArray(output) ||
    !('success' in output) ||
    typeof output.success !== 'boolean'
  ) {
    return output;
  }
  if (!has_only_keys(output, tool_result_envelope_keys)) return output;
  const data = 'data' in output ? output.data : undefined;
  const error = 'error' in output ? output.error : undefined;
  return data ?? error ?? output;
}

function read_catalog_node_payload(payload: unknown) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return payload;
  }
  if (!has_only_keys(payload, [...catalog_node_payload_keys, ...catalog_node_output_noise_keys])) {
    return payload;
  }

  const node_output = 'output' in payload ? payload.output : undefined;
  if (typeof node_output !== 'object' || node_output === null || Array.isArray(node_output)) {
    return node_output ?? payload;
  }

  const exports_value = 'exports' in node_output ? node_output.exports : undefined;
  const summary =
    typeof exports_value === 'object' &&
    exports_value !== null &&
    !Array.isArray(exports_value) &&
    '$summary' in exports_value &&
    typeof exports_value.$summary === 'string'
      ? exports_value.$summary
      : null;
  const returned = drop_keys(node_output, ['exports', ...catalog_node_output_noise_keys]);

  return { ...(summary === null ? {} : { summary }), ...hoist_returned_value(returned) };
}

// `ret` is the provider's word for "the return value". When it is the only thing left, its
// contents are the result, so they are shown directly rather than under a field nobody asked for.
function hoist_returned_value(returned: Record<string, unknown>) {
  const keys = Object.keys(returned);
  if (keys.length !== 1 || keys[0] !== 'ret') return returned;

  const value = returned.ret;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value }
    : { result: value };
}

function has_only_keys(record: object, allowed: readonly string[]) {
  const allowed_keys = new Set<string>(allowed);
  return Object.keys(record).every((key) => allowed_keys.has(key));
}

function drop_keys(record: object, dropped: readonly string[]) {
  const dropped_keys = new Set<string>(dropped);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !dropped_keys.has(key)));
}
