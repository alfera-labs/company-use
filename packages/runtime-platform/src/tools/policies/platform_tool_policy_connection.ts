import type { Database } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import { resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import type {
  RuntimeToolDefinition,
  RuntimeToolSourceContext,
} from '@runtime-platform/tools/types';

/** The connection a platform tool call acts through, so connection-scoped policies apply to it. */
export async function find_platform_tool_policy_connection_id(
  db: Database,
  input: {
    workspace_id: string;
    tool_input: unknown;
    participants?: Participants | undefined;
    room_private_to?: string | null | undefined;
    source_context?: RuntimeToolSourceContext | undefined;
  },
  tool: RuntimeToolDefinition,
) {
  const source_connection_id = input.source_context?.source_metadata?.slack?.connection_id;
  if (source_connection_id && tool.app_name === 'slack') return source_connection_id;
  if (tool.find_policy_connection_id) return tool.find_policy_connection_id(db, input);
  if (!tool.required_connection) return null;

  const resolved = await resolve_catalog_tool(db, {
    workspace_id: input.workspace_id,
    node_key: tool.node_key,
    ...(input.participants ? { participants: input.participants } : {}),
    room_private_to: input.room_private_to,
  });
  return resolved.connection?.connection_id ?? null;
}
