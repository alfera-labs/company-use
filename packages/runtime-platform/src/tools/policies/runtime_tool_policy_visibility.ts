import type { Database } from '@coworker/core';
import { resolve_tool_policy_modes } from '@coworker/core/access/resolve_tool_policies';
import type { SessionCurrentConnectionContext } from '@runtime-platform/orchestrator/context/current_connection_context';
import { get_all_tools } from '@runtime-platform/tools/tool_registry';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

export async function find_hidden_runtime_tool_names(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    agent_id?: string;
    actor_id: string;
    acting_actor_id?: string;
    source_context: RuntimeToolSourceContext;
    current_connection_context?: SessionCurrentConnectionContext;
  },
) {
  const modes = await resolve_tool_policy_modes(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    actor_id: input.actor_id,
    ...(input.acting_actor_id ? { acting_actor_id: input.acting_actor_id } : {}),
    tools: get_all_tools().map((tool) => ({
      node_key: tool.node_key,
      connection_id: find_runtime_policy_connection_id(
        tool,
        input.source_context,
        input.current_connection_context,
      ),
      approval_policy: tool.approval_policy,
      metadata: tool.metadata,
    })),
  });
  return new Set([...modes].filter(([, mode]) => mode === 'never').map(([node_key]) => node_key));
}

function find_runtime_policy_connection_id(
  tool: { app_name: string; required_connection: boolean },
  source_context: RuntimeToolSourceContext,
  current_context?: SessionCurrentConnectionContext,
) {
  if (current_context?.snapshot_status !== 'available') return null;
  const source_connection_id = source_context.source_metadata?.slack?.connection_id;
  const source_connection = current_context.connections.find(
    (connection) =>
      connection.connection_id === source_connection_id &&
      connection.app_name === tool.app_name &&
      connection.connection_status === 'active' &&
      connection.accessible,
  );
  if (source_connection) return source_connection.connection_id;
  if (!tool.required_connection) return null;

  return (
    [...current_context.connections]
      .filter(
        (connection) =>
          connection.app_name === tool.app_name &&
          connection.connection_status === 'active' &&
          connection.accessible,
      )
      .sort((left, right) => right.connected_time.localeCompare(left.connected_time))[0]
      ?.connection_id ?? null
  );
}
