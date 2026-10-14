import type { Database } from '@coworker/core';
import { add_session_approval_grants } from '@coworker/core/db/queries/session_approval_grants';
import { get_tool_call } from '@coworker/core/db/queries/sessions';

export async function allow_tools_in_this_chat(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    user_id: string;
    tool_call_ids: readonly string[];
  },
): Promise<{ remembered: boolean }> {
  const calls = await Promise.all(
    input.tool_call_ids.map((tool_call_id) => get_tool_call(db, input.workspace_id, tool_call_id)),
  );
  const node_keys = calls.flatMap((call) => (call ? [call.tool_name] : []));
  if (node_keys.length === 0) return { remembered: false };

  const grants = await add_session_approval_grants(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    node_keys,
    granted_by: input.user_id,
  });
  return { remembered: grants.length > 0 };
}
