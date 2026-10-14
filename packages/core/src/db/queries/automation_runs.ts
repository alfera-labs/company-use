import type { Database } from '@coworker/core/db/connection';
import { run_messages, runs, sessions } from '@coworker/core/db/schema';
import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm';

export async function count_runs_by_automation(
  db: Database,
  input: { workspace_id: string; automation_ids: string[] },
) {
  if (input.automation_ids.length === 0) return [];
  return db
    .select({
      automation_id: runs.automation_id,
      run_count: count(),
      last_run_time: max(runs.created_time),
    })
    .from(runs)
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        inArray(runs.automation_id, input.automation_ids),
      ),
    )
    .groupBy(runs.automation_id);
}

export async function list_automation_run_page(
  db: Database,
  input: {
    workspace_id: string;
    automation_id: string;
    page: number;
    page_size: number;
    reader_id: string;
  },
) {
  const where = and(
    eq(runs.workspace_id, input.workspace_id),
    eq(runs.automation_id, input.automation_id),
  );
  const [total_row, items] = await Promise.all([
    db.select({ total_count: count() }).from(runs).where(where),
    db
      .select({
        run_id: runs.run_id,
        session_id: runs.session_id,
        run_status: runs.run_status,
        error_message: runs.error_message,
        started_time: runs.started_time,
        finished_time: runs.finished_time,
        created_time: runs.created_time,
        is_unread: run_is_unread_for(input.reader_id),
      })
      .from(runs)
      .leftJoin(
        sessions,
        and(eq(sessions.workspace_id, runs.workspace_id), eq(sessions.session_id, runs.session_id)),
      )
      .where(where)
      .orderBy(desc(runs.created_time), desc(runs.run_id))
      .limit(input.page_size)
      .offset((input.page - 1) * input.page_size),
  ]);
  const total_count = total_row[0]?.total_count ?? 0;
  const first_run_number = total_count - (input.page - 1) * input.page_size;
  return {
    items: items.map((item, index) => ({ ...item, run_number: first_run_number - index })),
    total_count,
    page: input.page,
    page_size: input.page_size,
  };
}

function run_is_unread_for(reader_id: string) {
  return sql<boolean>`COALESCE((
    SELECT MAX(${run_messages.message_sequence})
    FROM ${run_messages}
    WHERE ${run_messages.workspace_id} = ${runs.workspace_id}
      AND ${run_messages.session_id} = ${runs.session_id}
      AND ${run_messages.run_id} = ${runs.run_id}
  ), 0) > COALESCE((
    ${sessions.session_metadata} -> 'read_markers' ->> ${reader_id}
  )::int, 0)`;
}
