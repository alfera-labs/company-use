import { createHash } from 'node:crypto';
import {
  build_node_key,
  catalog_app_name_max_length,
  catalog_node_version_maximum,
  maximum_node_name_length,
  normalize_machine_name,
} from '@coworker/shared';

export type McpToolSeed = {
  tool_name: string;
  display_name: string;
  description?: string | null | undefined;
  input_schema?: Record<string, unknown> | undefined;
  output_schema?: Record<string, unknown> | null | undefined;
  annotations?: { read_only: boolean | null; destructive: boolean | null } | undefined;
};

export type McpNodeValues = {
  node_name: string;
  node_key: string;
  node_display_name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  approval_policy: { mode: string };
  runtime_handler: string;
  tool_name: string;
  tool_digest: string;
};

export function generate_mcp_app_name(server_key: string): string {
  return build_stable_machine_name({
    value: `mcp_${server_key}`,
    stable_identity: `mcp:${server_key}`,
    maximum_length: catalog_app_name_max_length,
    fallback: 'mcp_server',
  });
}

export function build_mcp_node_values(input: {
  app_name: string;
  server_key: string;
  tools: readonly McpToolSeed[];
  trust_tool_annotations: boolean;
}): McpNodeValues[] {
  const maximum_length = maximum_node_name_length(input.app_name, catalog_node_version_maximum);
  const normalized_names = input.tools.map((tool) =>
    normalize_machine_name(tool.tool_name, {
      maximum_length: Number.MAX_SAFE_INTEGER,
      fallback: 'node',
    }),
  );
  const normalized_name_counts = count_values(normalized_names);

  const values = input.tools.map((tool, index) => {
    const normalized_name = normalized_names[index];
    if (!normalized_name) throw new Error('MCP tool name normalization lost its input row.');
    const node_name = build_stable_machine_name({
      value: tool.tool_name,
      stable_identity: tool.tool_name,
      maximum_length,
      fallback: 'node',
      force_suffix: (normalized_name_counts.get(normalized_name) ?? 0) > 1,
    });
    const input_schema = tool.input_schema ?? { type: 'object', properties: {} };
    return {
      node_name,
      node_key: build_node_key({ app_name: input.app_name, node_name, node_version: 1 }),
      node_display_name: tool.display_name,
      description: tool.description ?? null,
      input_schema,
      output_schema: tool.output_schema ?? { type: 'object', additionalProperties: true },
      approval_policy: calculate_mcp_approval_policy(tool, input.trust_tool_annotations),
      runtime_handler: `mcp.${input.server_key}.${tool.tool_name}`,
      tool_name: tool.tool_name,
      tool_digest: calculate_mcp_tool_digest({ tool_name: tool.tool_name, input_schema }),
    };
  });

  reject_duplicate_node_names(values);
  return values;
}

export function calculate_mcp_approval_policy(
  tool: McpToolSeed,
  trust_tool_annotations: boolean,
): { mode: string } {
  if (!trust_tool_annotations) return { mode: 'manual_review' };
  if (tool.annotations?.destructive === true) return { mode: 'manual_review' };
  return tool.annotations?.read_only === true ? { mode: 'none' } : { mode: 'manual_review' };
}

export function calculate_mcp_tool_digest(input: {
  tool_name: string;
  input_schema: Record<string, unknown>;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([input.tool_name, sort_json_keys(input.input_schema)]))
    .digest('hex')
    .slice(0, 32);
}

export function calculate_mcp_tool_list_digest(values: readonly McpNodeValues[]): string {
  const ordered = [...values].map((value) => value.tool_digest).sort();
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex').slice(0, 32);
}

function sort_json_keys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_json_keys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort_json_keys(item)]),
  );
}

function build_stable_machine_name(input: {
  value: string;
  stable_identity: string;
  maximum_length: number;
  fallback: string;
  force_suffix?: boolean;
}) {
  const normalized_name = normalize_machine_name(input.value, {
    maximum_length: Number.MAX_SAFE_INTEGER,
    fallback: input.fallback,
  });
  if (
    !input.force_suffix &&
    normalized_name === input.value.toLowerCase() &&
    normalized_name.length <= input.maximum_length
  ) {
    return normalized_name;
  }
  if (input.maximum_length < 10) {
    throw new Error(
      `Machine name maximum is too short for a stable suffix: ${input.maximum_length}`,
    );
  }

  const suffix = createHash('md5').update(input.stable_identity).digest('hex').slice(0, 8);
  return `${normalized_name.slice(0, input.maximum_length - 9)}_${suffix}`;
}

function count_values(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function reject_duplicate_node_names(values: readonly { node_name: string }[]) {
  const names = new Set<string>();
  for (const value of values) {
    if (names.has(value.node_name)) {
      throw new Error(`MCP tools normalize to the same node_name: ${value.node_name}`);
    }
    names.add(value.node_name);
  }
}
