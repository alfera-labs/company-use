import type { Database } from '@coworker/core/db/connection';
import { event_jobs } from '@coworker/core/db/schema';
import {
  event_jobs_held_with_token,
  type HeldEventJobs,
} from '@coworker/jobs/queries/event_job_leases';
import { sql } from 'drizzle-orm';

export type EventJobProgress = {
  completed_unit_count: number;
  total_unit_count: number;
};

export async function save_event_job_progress(
  db: Database,
  input: HeldEventJobs & { progress: EventJobProgress },
) {
  if (input.job_ids.length === 0) return [];
  return db
    .update(event_jobs)
    .set({
      result_data: sql`${event_jobs.result_data} || ${JSON.stringify({ progress: input.progress })}::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: 'system:events',
    })
    .where(event_jobs_held_with_token(input))
    .returning();
}
