import type { Database } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import {
  type get_tool_catalog_entry,
  resolve_catalog_tool,
} from '@coworker/core/db/queries/catalog';
import type { RuntimeToolResult } from '@coworker/shared';
import { tool_is_hidden_by_policy } from '@runtime-platform/tools/policies/tool_policy_visibility';

type CatalogTool = NonNullable<Awaited<ReturnType<typeof get_tool_catalog_entry>>>;
type ResolvedCatalogTool = Awaited<ReturnType<typeof resolve_catalog_tool>>;

export type ListToolFieldOptionsInput = {
  workspace_id: string;
  session_id?: string;
  agent_id?: string;
  actor_id?: string;
  node_key: string;
  field_name: string;
  current_input: Record<string, unknown>;
  acting_actor_id?: string;
  connection_id?: string;
  schema_id?: string;
  search_text?: string;
  page_number?: number;
  page_context?: Record<string, unknown>;
  participants?: Participants;
  room_private_to?: string | null | undefined;
};

type ToolFieldOptionsLister = (input: {
  workspace_id: string;
  field_name: string;
  current_input: Record<string, unknown>;
  tool: CatalogTool;
  connection: ResolvedCatalogTool['connection'];
  schema_id?: string;
  search_text?: string;
  page_number?: number;
  page_context?: Record<string, unknown>;
}) => Promise<RuntimeToolResult>;

const tool_field_options_listers: Record<string, ToolFieldOptionsLister> = {};

export async function list_tool_field_options(
  db: Database,
  input: ListToolFieldOptionsInput,
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
  const resolution_error = read_options_resolution_error(input.node_key, resolved);
  if (resolution_error) return resolution_error;
  const list_provider_options = tool_field_options_listers[tool.provider_key ?? ''];
  if (!list_provider_options) {
    return tool_error(
      'field_options_not_supported',
      `${input.node_key} does not provide searchable field options.`,
    );
  }

  return list_provider_options({
    workspace_id: input.workspace_id,
    field_name: input.field_name,
    current_input: input.current_input,
    tool,
    connection: resolved.connection,
    ...(input.schema_id ? { schema_id: input.schema_id } : {}),
    ...(input.search_text ? { search_text: input.search_text } : {}),
    ...(input.page_number ? { page_number: input.page_number } : {}),
    ...(input.page_context ? { page_context: input.page_context } : {}),
  });
}

function read_options_resolution_error(
  node_key: string,
  resolved: ResolvedCatalogTool,
): RuntimeToolResult | null {
  if (!resolved.tool) return tool_not_found(node_key);
  if (resolved.access_denied)
    return tool_error('access_denied', `${node_key} uses a private connection.`);
  if (!resolved.compatibility.ok) {
    return tool_error(
      resolved.compatibility.reason,
      `${node_key} field options are unavailable: ${resolved.compatibility.reason}.`,
    );
  }
  return null;
}

function tool_not_found(node_key: string): RuntimeToolResult {
  return tool_error('tool_not_found', `No active tool was found for ${node_key}.`);
}

function tool_error(code: string, message: string): RuntimeToolResult {
  return { success: false, error: { code, message } };
}
