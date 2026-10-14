export const model_tool_name_max_length = 64;
export const catalog_app_name_max_length = 49;
export const catalog_node_version_maximum = 999;

const machine_name_pattern = /^[a-z0-9_]+$/u;
const model_tool_name_pattern = /^[a-zA-Z0-9_-]+$/u;

export function normalize_machine_name(
  value: string,
  options: { maximum_length?: number; fallback?: string } = {},
) {
  const maximum_length = options.maximum_length ?? model_tool_name_max_length;
  const normalized_name = normalize_machine_name_characters(value);
  const fallback_name = normalize_machine_name_characters(options.fallback ?? '');
  const machine_name = normalized_name || fallback_name;

  if (!machine_name) throw new Error(`Machine name is empty after normalization: ${value}`);
  if (maximum_length < 1) throw new Error('Machine name maximum length must be positive.');
  return machine_name.slice(0, maximum_length);
}

export function maximum_node_name_length(app_name: string, node_version: number) {
  validate_machine_name(app_name, 'app_name');
  validate_node_version(node_version);

  const reserved_characters = app_name.length + String(node_version).length + 2;
  const maximum_length = model_tool_name_max_length - reserved_characters;
  if (maximum_length < 1) {
    throw new Error(
      `app_name and node_version leave no room for node_name: ${app_name}-${node_version}`,
    );
  }
  return maximum_length;
}

export function build_node_key(input: {
  app_name: string;
  node_name: string;
  node_version: number;
}) {
  validate_machine_name(input.app_name, 'app_name');
  validate_machine_name(input.node_name, 'node_name');
  validate_node_version(input.node_version);

  const node_key = `${input.app_name}-${input.node_name}-${input.node_version}`;
  if (node_key.length > model_tool_name_max_length) {
    throw new Error(`node_key exceeds ${model_tool_name_max_length} characters: ${node_key}`);
  }
  return node_key;
}

export function validate_model_tool_name(tool_name: string) {
  if (!model_tool_name_pattern.test(tool_name)) {
    throw new Error(
      `Tool name must use only letters, numbers, underscores, and hyphens: ${tool_name}`,
    );
  }
  if (tool_name.length > model_tool_name_max_length) {
    throw new Error(`Tool name exceeds ${model_tool_name_max_length} characters: ${tool_name}`);
  }
  return tool_name;
}

function normalize_machine_name_characters(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function validate_machine_name(value: string, field_name: string) {
  if (!machine_name_pattern.test(value)) {
    throw new Error(`${field_name} must match ${machine_name_pattern.source}: ${value}`);
  }
}

function validate_node_version(node_version: number) {
  if (
    !Number.isInteger(node_version) ||
    node_version < 1 ||
    node_version > catalog_node_version_maximum
  ) {
    throw new Error(
      `node_version must be between 1 and ${catalog_node_version_maximum}: ${node_version}`,
    );
  }
}
