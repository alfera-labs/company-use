import type { ConformanceNode } from '@coworker/connectors';
import { is_plain_record } from '@coworker/connectors';
import { type ComposioToolDefinition, get_composio_tool } from '@scripts/composio-recipes/composio_read_api';
import type { CatalogNodeRow } from '@scripts/composio-recipes/read_recipe_catalog';

export type DeprecationNote = {
  node_key: string;
  tool_slug: string;
  successor_slug: string | null;
  added_inputs: string[];
  removed_inputs: string[];
  required_inputs: string[];
};

const composio_handler_prefix = 'composio.';
const tool_slug_pattern = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){1,}\b/gu;

function tool_slug_of(row: CatalogNodeRow): string | null {
  return row.runtime_handler.startsWith(composio_handler_prefix)
    ? row.runtime_handler.slice(composio_handler_prefix.length)
    : null;
}

function has_typed_data(output_schema: unknown): boolean {
  if (!is_plain_record(output_schema) || !is_plain_record(output_schema.properties)) return false;
  const data = output_schema.properties.data;
  return is_plain_record(data) && (data.$ref !== undefined || is_plain_record(data.properties) || data.items !== undefined);
}

function wrap_tool_output(output_parameters: unknown): unknown {
  if (has_typed_data(output_parameters)) return output_parameters;
  return { type: 'object', properties: { data: output_parameters } };
}

async function load_one_node(
  row: CatalogNodeRow,
  open_node_keys: ReadonlySet<string>,
): Promise<ConformanceNode> {
  const node = { ...row, output_source: 'catalog' as const };
  const tool_slug = tool_slug_of(row);
  const catalog_is_enough = has_typed_data(row.output_schema) && !open_node_keys.has(row.node_key);
  if (catalog_is_enough || !tool_slug) return node;
  const tool = await get_composio_tool(tool_slug);
  return { ...node, output_schema: wrap_tool_output(tool.output_parameters), output_source: 'composio' };
}

export async function load_conformance_nodes(
  rows: readonly CatalogNodeRow[],
  open_node_keys: ReadonlySet<string> = new Set(),
) {
  const loaded = await Promise.all(rows.map((row) => load_one_node(row, open_node_keys)));
  return new Map(loaded.map((node) => [node.node_key, node]));
}

function list_input_names(input_parameters: unknown): { names: string[]; required: string[] } {
  if (!is_plain_record(input_parameters)) return { names: [], required: [] };
  const names = is_plain_record(input_parameters.properties) ? Object.keys(input_parameters.properties) : [];
  const required = Array.isArray(input_parameters.required) ? input_parameters.required.map(String) : [];
  return { names, required };
}

function compare_inputs(node_key: string, old_tool: ComposioToolDefinition, successor: ComposioToolDefinition | null): DeprecationNote {
  const old_inputs = list_input_names(old_tool.input_parameters);
  const new_inputs = list_input_names(successor?.input_parameters);
  return {
    node_key,
    tool_slug: old_tool.slug,
    successor_slug: successor?.slug ?? null,
    added_inputs: new_inputs.names.filter((name) => !old_inputs.names.includes(name)),
    removed_inputs: old_inputs.names.filter((name) => !new_inputs.names.includes(name)),
    required_inputs: new_inputs.required,
  };
}

async function describe_one_deprecation(row: CatalogNodeRow): Promise<DeprecationNote | null> {
  const tool_slug = tool_slug_of(row);
  if (!tool_slug) return null;
  const old_tool = await get_composio_tool(tool_slug);
  const recorded = row.successor_node_key ? null : old_tool.description?.match(tool_slug_pattern) ?? [];
  const candidates = (recorded ?? []).filter((slug) => slug !== tool_slug);
  const successor_slug = candidates[0] ?? null;
  const successor = successor_slug ? await get_composio_tool(successor_slug) : null;
  return compare_inputs(row.node_key, old_tool, successor);
}

export async function describe_deprecations(rows: readonly CatalogNodeRow[]): Promise<DeprecationNote[]> {
  const deprecated = rows.filter((row) => row.node_status !== 'active');
  const notes = await Promise.all(deprecated.map(describe_one_deprecation));
  return notes.filter((note): note is DeprecationNote => note !== null);
}
