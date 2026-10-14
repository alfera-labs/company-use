import type { Database } from '@coworker/core/db/connection';
import { event_jobs } from '@coworker/core/db/schema';
import type { EventJobHandlerResult } from '@coworker/jobs/event_job_handler';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';

const event_actor_id = 'system:events';
export const default_lock_milliseconds = 60_000;
const default_max_attempts = 5;
const default_max_interruptions = 10;

export type HeldEventJobs = { workspace_id: string; job_ids: string[]; lock_token: string };

export function event_jobs_held_with_token(input: HeldEventJobs) {
  return and(
    eq(event_jobs.workspace_id, input.workspace_id),
    eq(event_jobs.job_status, 'running'),
    eq(event_jobs.lock_token, input.lock_token),
    inArray(event_jobs.job_id, input.job_ids),
  );
}

export async function save_event_job_result(
  db: Database,
  input: HeldEventJobs & { result: EventJobHandlerResult },
) {
  if (input.job_ids.length === 0) return [];

  const next_status = input.result.retry_at
    ? input.result.retry_counts_as_attempt
      ? sql`case when ${event_jobs.attempt_count} >= ${default_max_attempts} then 'dead' else 'queued' end`
      : 'queued'
    : input.result.job_status;
  return db
    .update(event_jobs)
    .set({
      job_status: next_status,
      available_time: input.result.retry_at ?? new Date(),
      ...(input.result.retry_at && input.result.retry_counts_as_attempt !== true
        ? { attempt_count: sql`greatest(${event_jobs.attempt_count} - 1, 0)` }
        : {}),
      ...released_lock_values(),
      ...(input.result.run_id === undefined ? {} : { run_id: input.result.run_id }),
      result_data: input.result.result_data ?? {},
      error_data: input.result.error_data ?? {},
      last_updated_time: new Date(),
      last_updated_by: event_actor_id,
    })
    .where(event_jobs_held_with_token(input))
    .returning();
}

export async function recover_expired_event_jobs(
  db: Database,
  input: { now?: Date; max_interruptions?: number } = {},
) {
  const now = input.now ?? new Date();
  const max_interruptions = input.max_interruptions ?? default_max_interruptions;
  const interrupted_too_often = sql`${event_jobs.interruption_count} + 1 >= ${max_interruptions}`;
  return db
    .update(event_jobs)
    .set({
      job_status: sql`case when ${interrupted_too_often} then 'dead' else 'queued' end`,
      attempt_count: sql`greatest(${event_jobs.attempt_count} - 1, 0)`,
      interruption_count: sql`${event_jobs.interruption_count} + 1`,
      error_data: sql`case when ${interrupted_too_often} then ${JSON.stringify(interrupted_too_often_error(max_interruptions))}::jsonb else ${event_jobs.error_data} end`,
      available_time: now,
      ...released_lock_values(),
      last_updated_time: now,
      last_updated_by: event_actor_id,
    })
    .where(and(eq(event_jobs.job_status, 'running'), lte(event_jobs.locked_until, now)))
    .returning();
}

export async function extend_event_job_lock(
  db: Database,
  input: HeldEventJobs & { now?: Date; lock_milliseconds?: number },
) {
  if (input.job_ids.length === 0) return [];
  const now = input.now ?? new Date();
  const locked_until = new Date(
    now.getTime() + (input.lock_milliseconds ?? default_lock_milliseconds),
  );
  return db
    .update(event_jobs)
    .set({
      locked_until,
      last_updated_time: now,
      last_updated_by: event_actor_id,
    })
    .where(event_jobs_held_with_token(input))
    .returning();
}

export async function set_event_jobs_run_id(
  db: Database,
  input: HeldEventJobs & { run_id: string },
) {
  if (input.job_ids.length === 0) return [];

  return db
    .update(event_jobs)
    .set({
      run_id: input.run_id,
      last_updated_time: new Date(),
      last_updated_by: event_actor_id,
    })
    .where(event_jobs_held_with_token(input))
    .returning();
}

export async function release_event_job_claims(
  db: Database,
  input: HeldEventJobs & { now?: Date },
) {
  if (input.job_ids.length === 0) return [];
  const now = input.now ?? new Date();
  return db
    .update(event_jobs)
    .set({
      job_status: 'queued',
      available_time: now,
      attempt_count: sql`greatest(${event_jobs.attempt_count} - 1, 0)`,
      ...released_lock_values(),
      last_updated_time: now,
      last_updated_by: event_actor_id,
    })
    .where(event_jobs_held_with_token(input))
    .returning();
}

function released_lock_values() {
  return { locked_by: null, locked_until: null, lock_token: null };
}

function interrupted_too_often_error(max_interruptions: number) {
  return {
    code: 'event_job_interrupted_too_often',
    message: `The worker stopped ${max_interruptions} times while running this job without recording a result.`,
  };
}
