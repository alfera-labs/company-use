import { is_connector_app_held } from '@coworker/connectors';
import { resolve_tool_policy_modes } from '@coworker/core/access/resolve_tool_policies';
import {
  type CatalogToolResolution,
  type CatalogToolRow,
  list_catalog_api_fallback_tools,
  resolve_catalog_tools,
  search_tool_catalog,
} from '@coworker/core/db/queries/catalog';
import { create_logger } from '@coworker/shared';
import { list_connection_snapshot } from '@runtime-platform/connections/connection_snapshot';
import { project_catalog_search_result } from '@runtime-platform/tools/catalog_search_projection';
import {
  find_connected_app_name,
  select_catalog_api_fallbacks,
} from '@runtime-platform/tools/catalog_search_resolution';
import { is_connector_runtime_handler } from '@runtime-platform/tools/connector_executor';
import { tool_input_needs_schema_id } from '@runtime-platform/tools/tool_input_setup';
import { get_tool_schema } from '@runtime-platform/tools/tool_schema';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';

const log = create_logger('catalog_search');

const max_results_for_inlined_schema = 3;

type CatalogSearchInput = {
  query: string;
  app_name?: string | undefined;
  max_results: number;
  offset: number;
};

type CatalogSearchCandidates = {
  tools: CatalogToolRow[];
  fallback_tools: CatalogToolRow[];
  source_has_more: boolean;
};

type CatalogSearchSelection = {
  tools: CatalogToolRow[];
  fallback_tools: CatalogToolRow[];
  resolutions: CatalogToolResolution[];
};

export async function run_catalog_search(
  input: CatalogSearchInput,
  context: RuntimeToolExecutionContext,
) {
  const selected_app_name = await select_search_app_name(input, context);
  const candidates = await find_catalog_search_candidates(input, context, selected_app_name);
  const resolutions = await resolve_catalog_search_candidates(context, candidates);
  const connected = filter_offered_connector_tools({ ...candidates, resolutions });
  const visible = await filter_catalog_search_by_policy(context, connected);
  const top_tool_schema = await get_top_tool_schema(context, visible.tools);
  return {
    success: true as const,
    data: project_catalog_search_result({
      query: input.query,
      offset: input.offset,
      ...visible,
      source_has_more: candidates.source_has_more,
      top_tool_schema,
    }),
    metadata: { source: 'catalog_search' },
  };
}

async function find_catalog_search_candidates(
  input: CatalogSearchInput,
  context: RuntimeToolExecutionContext,
  selected_app_name: string | undefined,
): Promise<CatalogSearchCandidates> {
  const page = await search_tool_catalog(context.db, {
    workspace_id: context.workspace_id,
    query: input.query,
    ...(selected_app_name ? { app_name: selected_app_name } : {}),
    limit: input.max_results + 1,
    offset: input.offset,
  });
  const tools = page.slice(0, input.max_results);
  const available_fallback_tools = selected_app_name
    ? await list_catalog_api_fallback_tools(context.db, {
        workspace_id: context.workspace_id,
        app_names: [selected_app_name],
      })
    : [];
  const fallback_tools = select_catalog_api_fallbacks({
    query: input.query,
    offset: input.offset,
    ...(selected_app_name ? { selected_app_name } : {}),
    tools,
    fallback_tools: available_fallback_tools,
  });
  return { tools, fallback_tools, source_has_more: page.length > input.max_results };
}

function resolve_catalog_search_candidates(
  context: RuntimeToolExecutionContext,
  candidates: CatalogSearchCandidates,
) {
  return resolve_catalog_tools(context.db, {
    workspace_id: context.workspace_id,
    tools: unique_catalog_tools([...candidates.tools, ...candidates.fallback_tools]),
    ...(context.participants ? { participants: context.participants } : {}),
    room_private_to: context.room_private_to,
  });
}

function filter_offered_connector_tools(selection: CatalogSearchSelection): CatalogSearchSelection {
  const refused_node_ids = new Set(
    selection.resolutions
      .filter(is_connector_tool_refused)
      .map((resolution) => resolution.tool.node_id),
  );
  if (refused_node_ids.size === 0) return selection;
  return {
    tools: selection.tools.filter((tool) => !refused_node_ids.has(tool.node_id)),
    fallback_tools: selection.fallback_tools.filter((tool) => !refused_node_ids.has(tool.node_id)),
    resolutions: selection.resolutions.filter(
      (resolution) => !refused_node_ids.has(resolution.tool.node_id),
    ),
  };
}

function is_connector_tool_refused(resolution: CatalogToolResolution) {
  if (!is_connector_runtime_handler(resolution.tool.runtime_handler)) return false;
  return !resolution.connection || is_connector_app_held(resolution.tool.app_key);
}

async function filter_catalog_search_by_policy(
  context: RuntimeToolExecutionContext,
  selection: CatalogSearchSelection,
): Promise<CatalogSearchSelection> {
  const { resolutions } = selection;
  const policy_modes = await resolve_tool_policy_modes(context.db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    ...(context.agent_id ? { agent_id: context.agent_id } : {}),
    actor_id: context.actor_id,
    ...(context.speaker?.source_actor_id
      ? { acting_actor_id: context.speaker.source_actor_id }
      : {}),
    tools: resolutions.map((resolution) => ({
      node_key: resolution.tool.node_key,
      connection_id: resolution.connection?.connection_id ?? null,
      approval_policy: resolution.tool.approval_policy,
      metadata: resolution.tool.metadata,
    })),
  });
  const visible_node_ids = new Set(
    resolutions
      .filter((resolution) => policy_modes.get(resolution.tool.node_key) !== 'never')
      .map((resolution) => resolution.tool.node_id),
  );
  return {
    tools: selection.tools.filter((tool) => visible_node_ids.has(tool.node_id)),
    fallback_tools: selection.fallback_tools.filter((tool) => visible_node_ids.has(tool.node_id)),
    resolutions: resolutions.filter((resolution) => visible_node_ids.has(resolution.tool.node_id)),
  };
}

async function get_top_tool_schema(context: RuntimeToolExecutionContext, tools: CatalogToolRow[]) {
  const top_tool = tools[0];
  if (!top_tool || tools.length > max_results_for_inlined_schema) return undefined;
  if (tool_input_needs_schema_id(top_tool.input_schema)) return undefined;
  try {
    const result = await get_tool_schema(context.db, {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      ...(context.agent_id ? { agent_id: context.agent_id } : {}),
      actor_id: context.actor_id,
      ...(context.participants ? { participants: context.participants } : {}),
      room_private_to: context.room_private_to,
      node_key: top_tool.node_key,
      ...(context.speaker?.source_actor_id
        ? { acting_actor_id: context.speaker.source_actor_id }
        : {}),
    });
    if (!result.success) return undefined;
    return result.data as { node_key: string };
  } catch (error) {
    log.debug('Search returned without an inlined schema', { node_key: top_tool.node_key, error });
    return undefined;
  }
}

async function select_search_app_name(
  input: Pick<CatalogSearchInput, 'query' | 'app_name'>,
  context: RuntimeToolExecutionContext,
) {
  if (input.app_name) return input.app_name;
  const connections = await list_connection_snapshot(context.db, {
    workspace_id: context.workspace_id,
    ...(context.participants ? { participants: context.participants } : {}),
    room_private_to: context.room_private_to,
  });
  return find_connected_app_name(input.query, connections);
}

function unique_catalog_tools<T extends { node_id: string }>(tools: T[]) {
  return [...new Map(tools.map((tool) => [tool.node_id, tool])).values()];
}
