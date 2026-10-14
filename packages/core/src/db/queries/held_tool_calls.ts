import {
  read_calls_a_person_is_asked_about,
  tool_policy_approval_wait_schema,
} from '@coworker/core/access/tool_policy_approval_schema';
import type { Database } from '@coworker/core/db/connection';
import { list_session_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import { tool_calls } from '@coworker/core/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

export type HeldToolCall = {
  tool_call_id: string;
  tool_name: string;
  input_data: unknown;
  question: string | null;
};

/** The tool calls one session is holding until a person allows or denies them. */
export async function list_held_tool_calls(
  db: Database,
  input: { workspace_id: string; session_id: string },
): Promise<HeldToolCall[]> {
  const waits = await list_session_tool_policy_waits(db, { ...input, status: 'waiting' });
  const asked = waits.flatMap((wait) => {
    const approval = tool_policy_approval_wait_schema.safeParse(wait.metadata.policy_approval);
    if (!approval.success) return [];
    const question = approval.data.version === 2 ? (approval.data.question ?? null) : null;
    return read_calls_a_person_is_asked_about(approval.data).map((call) => ({
      tool_call_id: call.tool_call_id,
      question,
    }));
  });
  if (asked.length === 0) return [];

  const rows = await db
    .select({
      tool_call_id: tool_calls.tool_call_id,
      tool_name: tool_calls.tool_name,
      input_data: tool_calls.input_data,
    })
    .from(tool_calls)
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        inArray(
          tool_calls.tool_call_id,
          asked.map((call) => call.tool_call_id),
        ),
      ),
    );
  const row_by_id = new Map(rows.map((row) => [row.tool_call_id, row]));
  return asked.flatMap((call) => {
    const row = row_by_id.get(call.tool_call_id);
    return row ? [{ ...row, question: call.question }] : [];
  });
}
