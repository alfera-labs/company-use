import type { Database } from '@coworker/core';
import { resolve_tool_policy_mode } from '@coworker/core/access/resolve_tool_policies';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';

export async function tool_is_hidden_by_policy(
  db: Database,
  input: {
    context: Pick<
      RuntimeToolExecutionContext,
      'workspace_id' | 'session_id' | 'agent_id' | 'actor_id' | 'speaker'
    >;
    tool: {
      node_key: string;
      approval_policy: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };
    connection_id?: string | null;
  },
) {
  const mode = await resolve_tool_policy_mode(db, {
    workspace_id: input.context.workspace_id,
    session_id: input.context.session_id,
    ...(input.context.agent_id ? { agent_id: input.context.agent_id } : {}),
    actor_id: input.context.actor_id,
    ...(input.context.speaker?.source_actor_id
      ? { acting_actor_id: input.context.speaker.source_actor_id }
      : {}),
    tool: {
      node_key: input.tool.node_key,
      approval_policy: input.tool.approval_policy,
      metadata: input.tool.metadata,
      ...(input.connection_id ? { connection_id: input.connection_id } : {}),
    },
  });
  return mode === 'never';
}
