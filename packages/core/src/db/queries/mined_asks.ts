import type { Database } from '@coworker/core/db/connection';
import { run_messages, runs } from '@coworker/core/db/schema';
import { and, eq, gte, notLike, sql } from 'drizzle-orm';

export type MinedAsk = {
  run_id: string;
  session_id: string;
  asked_by: string;
  ask_text: string;
  occurred_at: Date;
};

export async function list_human_asks(
  db: Database,
  input: { workspace_id: string; since: Date; limit?: number | undefined },
): Promise<MinedAsk[]> {
  const rows = await db
    .selectDistinctOn([run_messages.run_id], {
      run_id: run_messages.run_id,
      session_id: run_messages.session_id,
      asked_by: runs.created_by,
      ask_text: run_messages.content_text,
      occurred_at: runs.created_time,
    })
    .from(run_messages)
    .innerJoin(runs, eq(runs.run_id, run_messages.run_id))
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        eq(run_messages.message_role, 'user'),
        eq(runs.trigger_type, 'user_message'),
        notLike(runs.created_by, 'system:%'),
        gte(runs.created_time, input.since),
        sql`${run_messages.content_text} is not null`,
      ),
    )
    .orderBy(run_messages.run_id, run_messages.run_message_sequence)
    .limit(input.limit ?? 500);

  return rows.flatMap((row) =>
    row.ask_text?.trim()
      ? [
          {
            run_id: row.run_id,
            session_id: row.session_id,
            asked_by: row.asked_by,
            ask_text: row.ask_text,
            occurred_at: row.occurred_at,
          },
        ]
      : [],
  );
}
