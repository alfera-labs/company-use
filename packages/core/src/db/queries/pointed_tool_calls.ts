import type { Database } from '@coworker/core/db/connection';
import { session_message_page_limit } from '@coworker/core/db/queries/session_read_pages';
import { run_messages, tool_calls } from '@coworker/core/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export type PointedToolCall = Pick<
  typeof tool_calls.$inferSelect,
  'tool_call_id' | 'tool_name' | 'tool_call_metadata' | 'output_data'
>;

export async function list_page_pointed_tool_calls(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    before_sequence?: number;
    limit?: number;
    pointer_shape: string;
  },
): Promise<PointedToolCall[]> {
  const newest_pointers = sql`
    SELECT newest.message_content -> 'parts' -> 0 ->> 'tool_call_id'
    FROM (
      SELECT ${run_messages.message_content} AS message_content FROM ${run_messages}
      WHERE ${run_messages.workspace_id} = ${input.workspace_id}
        AND ${run_messages.session_id} = ${input.session_id}
        ${
          input.before_sequence === undefined
            ? sql``
            : sql`AND ${run_messages.message_sequence} < ${input.before_sequence}`
        }
      ORDER BY ${run_messages.message_sequence} DESC
      LIMIT ${session_message_page_limit(input.limit) + 1}
    ) newest
    WHERE newest.message_content ->> 'shape' = ${input.pointer_shape}`;
  return db
    .select({
      tool_call_id: tool_calls.tool_call_id,
      tool_name: tool_calls.tool_name,
      tool_call_metadata: tool_calls.tool_call_metadata,
      output_data: tool_calls.output_data,
    })
    .from(tool_calls)
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        sql`${tool_calls.tool_call_id} IN (${newest_pointers})`,
      ),
    );
}
