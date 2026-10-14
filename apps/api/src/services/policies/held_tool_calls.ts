import type { Database } from '@coworker/core';
import type { ToolPolicyTarget } from '@coworker/core/access/resolve_tool_policies';
import { get_tool_call } from '@coworker/core/db/queries/sessions';
import { z } from 'zod';

export async function read_held_tool_calls(
  db: Database,
  workspace_id: string,
  tool_call_ids: readonly string[],
): Promise<ToolPolicyTarget[]> {
  const calls = await Promise.all(
    tool_call_ids.map((tool_call_id) => get_tool_call(db, workspace_id, tool_call_id)),
  );
  return calls.flatMap((call) => {
    if (!call) return [];
    const held = read_held_call_metadata(call.tool_call_metadata);
    return [
      {
        node_key: call.tool_name,
        connection_id: call.connection_id ?? held.connection_id ?? null,
        approval_policy: null,
        metadata: { policy_labels: held.approval_labels },
        tool_input: call.input_data,
      },
    ];
  });
}

const held_call_metadata = z.object({
  connection_id: z.string().min(1).optional().catch(undefined),
  approval_labels: z.array(z.string()).default([]).catch([]),
});

function read_held_call_metadata(value: unknown) {
  return held_call_metadata.safeParse(value).data ?? { approval_labels: [] };
}
