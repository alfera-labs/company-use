import type { Database } from '@coworker/core/db/connection';
import { event_jobs, events } from '@coworker/core/db/schema';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';

export const event_job_queue_barrier_metadata_key = 'blocks_later_subject_jobs';

export const event_job_claimed_alone_metadata_key = 'claimed_alone';

export async function list_events_for_event_jobs(
  db: Database,
  input: {
    workspace_id: string;
    event_jobs: Array<{ event_id: string | null }>;
  },
) {
  const event_ids = input.event_jobs.flatMap((job) => (job.event_id ? [job.event_id] : []));
  if (event_ids.length === 0) return [];

  return db.query.events.findMany({
    where: and(eq(events.workspace_id, input.workspace_id), inArray(events.event_id, event_ids)),
    orderBy: (table) => [asc(table.created_time), asc(table.event_id)],
  });
}

export async function find_running_event_job_for_run(
  db: Database,
  input: { workspace_id: string; run_id: string },
) {
  const [job] = await db
    .select({ queue_key: event_jobs.queue_key, locked_by: event_jobs.locked_by })
    .from(event_jobs)
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.run_id, input.run_id),
        eq(event_jobs.job_status, 'running'),
      ),
    )
    .limit(1);
  return job ?? null;
}

export async function find_next_queued_event_job_for_queue(
  db: Database,
  input: { workspace_id: string; queue_key: string },
) {
  const [next_job] = await db
    .select()
    .from(event_jobs)
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.queue_key, input.queue_key),
        eq(event_jobs.job_status, 'queued'),
      ),
    )
    .orderBy(asc(event_jobs.available_time), asc(event_jobs.created_time), asc(event_jobs.job_id))
    .limit(1);
  return next_job ?? null;
}

export async function find_active_event_job_for_queue(
  db: Database,
  input: { workspace_id: string; queue_key: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return (
    (await db.query.event_jobs.findFirst({
      where: and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.queue_key, input.queue_key),
        eq(event_jobs.job_status, 'running'),
        gt(event_jobs.locked_until, now),
      ),
      orderBy: (table) => [asc(table.locked_until), asc(table.job_id)],
    })) ?? null
  );
}

export async function find_latest_queued_job_time_for_queue(
  db: Database,
  input: { workspace_id: string; queue_key: string },
): Promise<Date | null> {
  const [row] = await db
    .select({ latest: sql<string | Date | null>`max(${event_jobs.available_time})` })
    .from(event_jobs)
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.queue_key, input.queue_key),
        eq(event_jobs.job_status, 'queued'),
      ),
    );
  if (!row?.latest) return null;
  return row.latest instanceof Date ? row.latest : new Date(row.latest);
}

export async function find_latest_queued_barrier_time_for_queue(
  db: Database,
  input: { workspace_id: string; queue_key: string },
): Promise<Date | null> {
  const [row] = await db
    .select({ latest: sql<string | Date | null>`max(${event_jobs.available_time})` })
    .from(event_jobs)
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.queue_key, input.queue_key),
        eq(event_jobs.job_status, 'queued'),
        is_queue_barrier_job(),
      ),
    );
  if (!row?.latest) return null;
  return row.latest instanceof Date ? row.latest : new Date(row.latest);
}

export async function list_queues_with_queued_event_jobs(
  db: Database,
  input: { workspace_id: string; queue_keys: string[] },
): Promise<Set<string>> {
  if (input.queue_keys.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ queue_key: event_jobs.queue_key })
    .from(event_jobs)
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        inArray(event_jobs.queue_key, input.queue_keys),
        inArray(event_jobs.job_status, ['queued', 'running']),
      ),
    );
  return new Set(rows.flatMap((row) => (row.queue_key ? [row.queue_key] : [])));
}

export function is_queue_barrier_job() {
  return sql`${event_jobs.metadata} ->> ${event_job_queue_barrier_metadata_key} = 'true'`;
}
