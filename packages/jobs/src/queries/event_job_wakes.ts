import type { Database } from '@coworker/core/db/connection';
import { event_jobs } from '@coworker/core/db/schema';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

const event_actor_id = 'system:events';

export async function mark_wake_sent(
  db: Database,
  input: { workspace_id: string; job_ids: string[]; now?: Date },
) {
  if (input.job_ids.length === 0) return [];
  const now = input.now ?? new Date();
  return db
    .update(event_jobs)
    .set({ wake_sent_time: now, last_updated_time: now, last_updated_by: event_actor_id })
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.job_status, 'queued'),
        inArray(event_jobs.job_id, input.job_ids),
      ),
    )
    .returning({ job_id: event_jobs.job_id, wake_sent_time: event_jobs.wake_sent_time });
}

export async function mark_queue_wake_sent(
  db: Database,
  input: { workspace_id: string; queue_key: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return db
    .update(event_jobs)
    .set({ wake_sent_time: now, last_updated_time: now, last_updated_by: event_actor_id })
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.queue_key, input.queue_key),
        eq(event_jobs.job_status, 'queued'),
      ),
    )
    .returning({ job_id: event_jobs.job_id });
}

export async function list_queued_jobs_with_stale_wake(
  db: Database,
  input: { older_than_seconds: number; limit: number; now?: Date },
) {
  if (input.limit < 1) return [];
  const now = input.now ?? new Date();
  const rung_before = new Date(now.getTime() - input.older_than_seconds * 1000);
  return db
    .select({
      job_id: event_jobs.job_id,
      workspace_id: event_jobs.workspace_id,
      queue_key: event_jobs.queue_key,
      wake_sent_time: event_jobs.wake_sent_time,
    })
    .from(event_jobs)
    .where(
      and(
        eq(event_jobs.job_status, 'queued'),
        lte(event_jobs.available_time, now),
        or(
          lte(event_jobs.wake_sent_time, rung_before),
          and(isNull(event_jobs.wake_sent_time), lte(event_jobs.available_time, rung_before)),
        ),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${event_jobs.wake_sent_time}, ${event_jobs.available_time})`),
      asc(event_jobs.job_id),
    )
    .limit(input.limit);
}
