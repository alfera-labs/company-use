import type { CatalogToolResolution, CatalogToolRow } from '@coworker/core/db/queries/catalog';
import {
  compact_tool_summary,
  summarize_api_fallback,
  summarize_catalog_tool,
} from '@runtime-platform/tools/catalog_tool_search_summary';

const model_visible_search_limit = 3_400;
const model_visible_search_with_schema_limit = 12_000;

const execution_protocol = {
  node_keys_are_callable: false,
  schema_tool: 'runtime-get_tool_schema-1',
  execute_tool: 'runtime-execute_tool-1',
} as const;

export function project_catalog_search_result(input: {
  query: string;
  offset: number;
  tools: CatalogToolRow[];
  fallback_tools: CatalogToolRow[];
  resolutions: CatalogToolResolution[];
  source_has_more: boolean;
  top_tool_schema?: { node_key: string } | undefined;
}) {
  const resolution_by_node_id = new Map(
    input.resolutions.map((resolution) => [resolution.tool.node_id, resolution]),
  );
  const fallback_tools = input.fallback_tools.map((tool) =>
    summarize_api_fallback(tool, require_resolution(tool, resolution_by_node_id)),
  );
  const summaries = input.tools.map((tool) =>
    summarize_catalog_tool(tool, require_resolution(tool, resolution_by_node_id)),
  );
  const tools = fit_tool_summaries(input, summaries, fallback_tools);
  const has_more = input.source_has_more || tools.length < summaries.length;

  const result = {
    query: input.query,
    offset: input.offset,
    execution_protocol,
    result_count: tools.length,
    tools,
    fallback_tools,
    has_more,
    next_offset: has_more ? input.offset + tools.length : null,
  };
  return attach_top_tool_schema(result, input.top_tool_schema) ?? result;
}

function attach_top_tool_schema<R extends { tools: Array<{ node_key: string }> }>(
  result: R,
  schema: { node_key: string } | undefined,
) {
  const [top_tool, ...other_tools] = result.tools;
  if (!schema || !top_tool || top_tool.node_key !== schema.node_key) return null;
  const with_schema = {
    ...result,
    execution_protocol: { ...execution_protocol, schema_inlined_for: schema.node_key },
    tools: [{ ...top_tool, schema }, ...other_tools],
  };
  if (JSON.stringify(with_schema).length > model_visible_search_with_schema_limit) return null;
  return with_schema;
}

function fit_tool_summaries(
  input: { query: string; offset: number; source_has_more: boolean },
  summaries: ReturnType<typeof summarize_catalog_tool>[],
  fallback_tools: ReturnType<typeof summarize_api_fallback>[],
) {
  if (projected_search_length(input, summaries, fallback_tools) <= model_visible_search_limit) {
    return summaries;
  }

  const compact_summaries = summaries.map(compact_tool_summary);
  return take_tool_summaries_that_fit(input, compact_summaries, fallback_tools);
}

function take_tool_summaries_that_fit<T>(
  input: { query: string; offset: number; source_has_more: boolean },
  summaries: T[],
  fallback_tools: ReturnType<typeof summarize_api_fallback>[],
) {
  const tools: T[] = [];
  for (const summary of summaries) {
    const candidate = [...tools, summary];
    if (
      tools.length > 0 &&
      projected_search_length(input, candidate, fallback_tools) > model_visible_search_limit
    ) {
      break;
    }
    tools.push(summary);
  }
  return tools;
}

function projected_search_length(
  input: { query: string; offset: number; source_has_more: boolean },
  tools: unknown[],
  fallback_tools: ReturnType<typeof summarize_api_fallback>[],
) {
  return JSON.stringify({
    query: input.query,
    offset: input.offset,
    execution_protocol,
    tools,
    fallback_tools,
    has_more: input.source_has_more,
  }).length;
}

function require_resolution(
  tool: CatalogToolRow,
  resolution_by_node_id: Map<string, CatalogToolResolution>,
) {
  const resolution = resolution_by_node_id.get(tool.node_id);
  if (!resolution) throw new Error(`Missing catalog resolution for ${tool.node_key}`);
  return resolution;
}
