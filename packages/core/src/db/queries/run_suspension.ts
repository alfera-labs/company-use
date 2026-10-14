import type { Database } from '@coworker/core/db/connection';
import { event_jobs, run_events, runs } from '@coworker/core/db/schema';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';

export async function record_run_wait(
  db: Database,
  input: { workspace_id: string; run_id: string; job_id: string; actor_id: string },
) {
  const [run] = await db
    .update(runs)
    .set({
      waiting_on_job_id: input.job_id,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(runs.workspace_id, input.workspace_id), eq(runs.run_id, input.run_id)))
    .returning();
  return run ?? null;
}

export async function mark_run_waiting(
  db: Database,
  input: { workspace_id: string; run_id: string; actor_id: string },
) {
  const now = new Date();
  const [run] = await db
    .update(runs)
    .set({ run_status: 'waiting', last_updated_time: now, last_updated_by: input.actor_id })
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        eq(runs.run_id, input.run_id),
        eq(runs.run_status, 'running'),
        isNotNull(runs.waiting_on_job_id),
      ),
    )
    .returning();
  return run ?? null;
}

export async function mark_run_completion_waiting(
  db: Database,
  input: { workspace_id: string; run_id: string; actor_id: string },
) {
  const [event] = await db
    .update(run_events)
    .set({
      event_data: sql`jsonb_set(${run_events.event_data}, '{run_status}', '"waiting"'::jsonb)`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(run_events.workspace_id, input.workspace_id),
        eq(run_events.run_id, input.run_id),
        eq(run_events.event_type, 'chat_event'),
        eq(run_events.event_label, 'run_completed'),
      ),
    )
    .returning();
  return event ?? null;
}

export async function release_waiting_run(
  db: Database,
  input: { workspace_id: string; run_id: string; actor_id: string },
) {
  const now = new Date();
  const [run] = await db
    .update(runs)
    .set({
      run_status: 'completed',
      completed_time: now,
      finished_time: now,
      last_updated_time: now,
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        eq(runs.run_id, input.run_id),
        eq(runs.run_status, 'waiting'),
      ),
    )
    .returning();
  return run ?? null;
}

export async function find_run_wait(db: Database, input: { workspace_id: string; run_id: string }) {
  const run = await db.query.runs.findFirst({
    where: and(eq(runs.workspace_id, input.workspace_id), eq(runs.run_id, input.run_id)),
    columns: { waiting_on_job_id: true },
  });
  if (!run?.waiting_on_job_id) return null;

  return (
    (await db.query.event_jobs.findFirst({
      where: and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.job_id, run.waiting_on_job_id),
      ),
    })) ?? null
  );
}

export async function list_expired_waits(db: Database, input: { limit?: number } = {}) {
  return db.query.event_jobs.findMany({
    where: and(
      eq(event_jobs.job_status, 'waiting'),
      isNotNull(event_jobs.awaits_until_time),
      sql`${event_jobs.awaits_until_time} < now()`,
    ),
    orderBy: [asc(event_jobs.awaits_until_time), asc(event_jobs.job_id)],
    limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
  });
}
