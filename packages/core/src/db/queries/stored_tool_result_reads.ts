import type { Database } from '@coworker/core/db/connection';
import { run_messages, tool_calls } from '@coworker/core/db/schema';
import { and, eq, inArray, or, sql } from 'drizzle-orm';

export async function list_tool_call_outputs(
  db: Database,
  input: {
    workspace_id: string;
    tool_call_ids?: readonly string[];
    idempotency_keys?: readonly string[];
  },
) {
  const tool_call_ids = [...new Set(input.tool_call_ids ?? [])];
  const idempotency_keys = [...new Set(input.idempotency_keys ?? [])];
  if (tool_call_ids.length === 0 && idempotency_keys.length === 0) return [];

  return db
    .select({
      tool_call_id: tool_calls.tool_call_id,
      tool_name: tool_calls.tool_name,
      tool_call_metadata: tool_calls.tool_call_metadata,
      idempotency_key: tool_calls.idempotency_key,
      input_data: tool_calls.input_data,
      output_data: tool_calls.output_data,
      output_text: tool_calls.output_text,
    })
    .from(tool_calls)
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        or(
          ...(tool_call_ids.length === 0 ? [] : [inArray(tool_calls.tool_call_id, tool_call_ids)]),
          ...(idempotency_keys.length === 0
            ? []
            : [inArray(tool_calls.idempotency_key, idempotency_keys)]),
        ),
      ),
    );
}

export async function find_tool_call_output_shape(
  db: Database,
  input: { workspace_id: string; idempotency_key: string },
) {
  const [row] = await db
    .select({ output_shape: sql<string | null>`${tool_calls.output_data} ->> 'shape'` })
    .from(tool_calls)
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        eq(tool_calls.idempotency_key, input.idempotency_key),
      ),
    )
    .limit(1);
  return row?.output_shape ?? null;
}

export async function list_run_assistant_message_contents(
  db: Database,
  input: { workspace_id: string; run_ids: readonly string[] },
) {
  const run_ids = [...new Set(input.run_ids)];
  if (run_ids.length === 0) return [];

  return db
    .select({ run_id: run_messages.run_id, message_content: run_messages.message_content })
    .from(run_messages)
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        inArray(run_messages.run_id, run_ids),
        eq(run_messages.message_role, 'assistant'),
      ),
    );
}
