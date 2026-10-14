import type { Database } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import {
  type get_tool_catalog_entry,
  resolve_catalog_tool,
} from '@coworker/core/db/queries/catalog';
import type { RuntimeToolFailure, RuntimeToolResult } from '@coworker/shared';
import { build_api_proxy_contract } from '@runtime-platform/tools/api_proxy_contract';
import { tool_is_hidden_by_policy } from '@runtime-platform/tools/policies/tool_policy_visibility';
import { tool_input_needs_schema_id } from '@runtime-platform/tools/tool_input_setup';

type CatalogTool = NonNullable<Awaited<ReturnType<typeof get_tool_catalog_entry>>>;
type ResolvedCatalogTool = Awaited<ReturnType<typeof resolve_catalog_tool>>;
type ToolInputSchema = CatalogTool['input_schema'];

export type GetToolSchemaInput = {
  workspace_id: string;
  session_id?: string;
  run_id?: string;
  agent_id?: string;
  actor_id?: string;
  node_key: string;
  current_input?: Record<string, unknown>;
  acting_actor_id?: string;
  connection_id?: string;
  schema_id?: string;
  participants?: Participants;
  room_private_to?: string | null | undefined;
};

type ToolSchemaGetter = (input: {
  workspace_id: string;
  current_input: Record<string, unknown>;
  tool: CatalogTool;
  connection: ResolvedCatalogTool['connection'];
  schema_id?: string;
}) => Promise<
  | RuntimeToolFailure
  | {
      success: true;
      data: { schema_id: string | null; input_schema: ToolInputSchema };
      metadata: Record<string, unknown>;
    }
>;

const tool_schema_getters: Record<string, ToolSchemaGetter> = {};

const tool_input_schema_projections: Record<
  string,
  (schema: ToolInputSchema, metadata: CatalogTool['metadata']) => ToolInputSchema
> = {};

export async function get_tool_schema(
  db: Database,
  input: GetToolSchemaInput,
): Promise<RuntimeToolResult> {
  const resolved = await resolve_catalog_tool(db, {
    workspace_id: input.workspace_id,
    node_key: input.node_key,
    ...(input.connection_id ? { connection_id: input.connection_id } : {}),
    ...(input.participants ? { participants: input.participants } : {}),
    room_private_to: input.room_private_to,
  });
  const tool = resolved.tool;
  if (!tool) return tool_not_found(input.node_key);
  if (
    input.session_id &&
    input.actor_id &&
    (await tool_is_hidden_by_policy(db, {
      context: {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        ...(input.agent_id ? { agent_id: input.agent_id } : {}),
        actor_id: input.actor_id,
        ...(input.acting_actor_id
          ? { speaker: { source_actor_id: input.acting_actor_id, name: input.acting_actor_id } }
          : {}),
      },
      tool,
      connection_id: resolved.connection?.connection_id ?? null,
    }))
  ) {
    return tool_not_found(input.node_key);
  }
  if (input.current_input === undefined) return tool_schema_result(tool, tool.input_schema, null);
  const resolution_error = get_schema_resolution_error(input.node_key, resolved);
  if (resolution_error) return resolution_error;
  const get_provider_schema = tool_schema_getters[tool.provider_key ?? ''];
  if (!get_provider_schema) {
    return tool_error(
      'dynamic_schema_not_supported',
      `${input.node_key} does not provide a schema that changes with its input.`,
    );
  }

  const provider_result = await get_provider_schema({
    workspace_id: input.workspace_id,
    current_input: input.current_input,
    tool,
    connection: resolved.connection,
    ...(input.schema_id ? { schema_id: input.schema_id } : {}),
  });
  if (!provider_result.success) return provider_result;
  const schema_id = provider_result.data.schema_id;
  if (tool_input_needs_schema_id(tool.input_schema) && !schema_id) {
    return tool_error(
      'tool_schema_id_unavailable',
      `${input.node_key} returned changing input fields without the schema_id required to execute them. Retry runtime-get_tool_schema-1.`,
    );
  }
  return tool_schema_result(
    tool,
    provider_result.data.input_schema,
    schema_id,
    provider_result.metadata,
  );
}

function tool_schema_result(
  tool: CatalogTool,
  input_schema: ToolInputSchema,
  schema_id: string | null,
  metadata: Record<string, unknown> = { source: 'catalog_entry' },
): RuntimeToolResult {
  const api_proxy_contract = build_api_proxy_contract(tool);
  const project_input_schema = tool_input_schema_projections[tool.provider_key ?? ''];
  const projected_input_schema = project_input_schema
    ? project_input_schema(input_schema, tool.metadata)
    : input_schema;
  return {
    success: true,
    data: {
      node_key: tool.node_key,
      app_name: tool.app_name,
      node_name: tool.node_name,
      description: tool.metadata.description ?? null,
      category: tool.metadata.category ?? tool.app_category ?? 'tools',
      requires_connection: tool_requires_connection(tool),
      input_schema: projected_input_schema,
      output_schema: tool.output_schema,
      schema_id,
      ...(api_proxy_contract ? { api_proxy_contract } : {}),
    },
    metadata,
  };
}

function get_schema_resolution_error(
  node_key: string,
  resolved: ResolvedCatalogTool,
): RuntimeToolResult | null {
  if (!resolved.tool) return tool_not_found(node_key);
  if (resolved.access_denied)
    return tool_error('access_denied', `${node_key} uses a private connection.`);
  if (!resolved.compatibility.ok) {
    return tool_error(
      resolved.compatibility.reason,
      `${node_key} schema is unavailable: ${resolved.compatibility.reason}.`,
    );
  }
  return null;
}

function tool_not_found(node_key: string): RuntimeToolResult {
  return tool_error('tool_not_found', `No active tool was found for ${node_key}.`);
}

function tool_requires_connection(tool: CatalogTool) {
  return tool.connection_profile_key !== null || tool.metadata.required_connection === true;
}

function tool_error(code: string, message: string): RuntimeToolResult {
  return { success: false, error: { code, message } };
}
