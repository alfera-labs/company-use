import type { Database } from '@coworker/core/db/connection';
import { run_messages } from '@coworker/core/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';

export type RecentDeliverable = {
  run_id: string;
  session_id: string;
  first_line: string;
  created_time: Date;
};

export async function list_recent_deliverables(
  db: Database,
  input: {
    workspace_id: string;
    now?: Date | undefined;
    days?: number | undefined;
    limit?: number;
  },
): Promise<RecentDeliverable[]> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - (input.days ?? 7) * 24 * 60 * 60 * 1_000);
  const limit = input.limit ?? 15;
  const rows = await db
    .selectDistinctOn([run_messages.run_id], {
      run_id: run_messages.run_id,
      session_id: run_messages.session_id,
      content_text: run_messages.content_text,
      created_time: run_messages.created_time,
    })
    .from(run_messages)
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        eq(run_messages.message_role, 'assistant'),
        eq(run_messages.is_user_visible, true),
        gte(run_messages.created_time, since),
      ),
    )
    .orderBy(run_messages.run_id, desc(run_messages.message_sequence));

  return rows
    .flatMap((row) => {
      const first_line = (row.content_text ?? '').trim().split('\n')[0]?.trim();
      if (!first_line) return [];
      return [
        {
          run_id: row.run_id,
          session_id: row.session_id,
          first_line: first_line.slice(0, 200),
          created_time: row.created_time,
        },
      ];
    })
    .sort((left, right) => right.created_time.getTime() - left.created_time.getTime())
    .slice(0, limit);
}
