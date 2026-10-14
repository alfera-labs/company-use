import { randomUUID } from 'node:crypto';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core/db/connection';
import { workspace_has_room_for_another_run_condition } from '@coworker/core/db/queries/events';
import { event_jobs, workspaces } from '@coworker/core/db/schema';
import { default_lock_milliseconds } from '@coworker/jobs/queries/event_job_leases';
import {
  event_job_claimed_alone_metadata_key,
  event_job_queue_barrier_metadata_key,
} from '@coworker/jobs/queries/event_job_reads';
import { and, asc, eq, lte, sql } from 'drizzle-orm';

const event_actor_id = 'system:events';
const default_claim_limit = 50;

export async function claim_ready_event_jobs_for_queue(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    worker_id: string;
    now?: Date;
    lock_milliseconds?: number;
    limit?: number;
  },
) {
  return db.transaction(async (tx) => claim_ready_event_jobs_in_transaction(tx as Database, input));
}

export async function claim_next_ready_event_jobs(
  db: Database,
  input: { workspace_id?: string; worker_id: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const max_claim_attempts = Math.max(env.WORKER_RECOVERY_DISPATCH_CONCURRENCY, 8);
  for (let claim_attempt = 0; claim_attempt < max_claim_attempts; claim_attempt += 1) {
    const next_queue = await find_next_ready_queue(db, input, now);
    if (!next_queue) return [];
    const claimed_jobs = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: next_queue.workspace_id,
      queue_key: next_queue.queue_key,
      worker_id: input.worker_id,
      now,
    });
    if (claimed_jobs.length > 0) return claimed_jobs;
  }

  return [];
}

export async function list_ready_event_job_queues(
  db: Database,
  input: { limit: number; now?: Date },
) {
  if (input.limit < 1) return [];

  return db
    .selectDistinctOn([event_jobs.workspace_id, event_jobs.queue_key], {
      workspace_id: event_jobs.workspace_id,
      queue_key: event_jobs.queue_key,
    })
    .from(event_jobs)
    .where(next_ready_queue_condition({}, input.now ?? new Date()))
    .orderBy(
      asc(event_jobs.workspace_id),
      asc(event_jobs.queue_key),
      asc(event_jobs.available_time),
      asc(event_jobs.created_time),
      asc(event_jobs.job_id),
    )
    .limit(input.limit);
}

async function claim_ready_event_jobs_in_transaction(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    worker_id: string;
    now?: Date;
    lock_milliseconds?: number;
    limit?: number;
  },
) {
  const now = input.now ?? new Date();
  await lock_workspace_event_job_admission(db, input.workspace_id);
  return lock_ready_event_jobs(db, input, now);
}

async function lock_workspace_event_job_admission(db: Database, workspace_id: string) {
  await db.execute(sql`
    select 1
    from ${workspaces}
    where ${workspaces.workspace_id} = ${workspace_id}
    for update
  `);
}

function claimable_job_ids_sql(
  input: { workspace_id: string; queue_key: string; limit?: number },
  now: Date,
) {
  const job_order = sql`${event_jobs.available_time}, ${event_jobs.created_time}, ${event_jobs.job_id}`;
  return sql`(
    select ranked.job_id from (
      select ready.job_id, ready.position,
        min(case when ready.claimed_alone then ready.position end) over () as first_alone_position
      from (
        select ${event_jobs.job_id} as job_id,
          row_number() over (order by ${job_order}) as position,
          coalesce(${event_jobs.metadata} ->> ${event_job_claimed_alone_metadata_key} = 'true', false)
            as claimed_alone
        from ${event_jobs}
        where ${and(
          eq(event_jobs.queue_key, input.queue_key),
          next_ready_queue_condition({ workspace_id: input.workspace_id }, now),
        )}
        order by ${job_order}
        limit ${input.limit ?? default_claim_limit}
      ) ready
    ) ranked
    where ranked.first_alone_position is null
      or ranked.position < ranked.first_alone_position
      or (ranked.first_alone_position = 1 and ranked.position = 1)
  )`;
}

async function lock_ready_event_jobs(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    worker_id: string;
    lock_milliseconds?: number;
    limit?: number;
  },
  now: Date,
) {
  const locked_until = new Date(
    now.getTime() + (input.lock_milliseconds ?? default_lock_milliseconds),
  );
  return db
    .update(event_jobs)
    .set({
      job_status: 'running',
      locked_by: input.worker_id,
      lock_token: randomUUID(),
      locked_until,
      wake_sent_time: null,
      attempt_count: sql`${event_jobs.attempt_count} + 1`,
      last_updated_time: now,
      last_updated_by: event_actor_id,
    })
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.job_status, 'queued'),
        sql`${event_jobs.job_id} in ${claimable_job_ids_sql(input, now)}`,
      ),
    )
    .returning();
}

async function find_next_ready_queue(
  db: Database,
  input: { workspace_id?: string | undefined },
  now: Date,
) {
  const [next_job] = await db
    .select({
      workspace_id: event_jobs.workspace_id,
      queue_key: event_jobs.queue_key,
    })
    .from(event_jobs)
    .where(next_ready_queue_condition(input, now))
    .orderBy(asc(event_jobs.available_time), asc(event_jobs.created_time))
    .limit(1);
  return next_job ?? null;
}

function next_ready_queue_condition(input: { workspace_id?: string | undefined }, now: Date) {
  const conditions = [
    eq(event_jobs.job_status, 'queued'),
    lte(event_jobs.available_time, now),
    sql`not exists (
      select 1
      from "event_jobs" locked_jobs
      where locked_jobs."workspace_id" = ${event_jobs.workspace_id}
        and locked_jobs."subject_key" = ${event_jobs.queue_key}
        and locked_jobs."job_status" = 'running'
        and locked_jobs."locked_until" > ${now.toISOString()}::timestamptz
    )`,
    sql`not exists (
      select 1
      from "event_jobs" barrier_jobs
      where barrier_jobs."workspace_id" = ${event_jobs.workspace_id}
        and barrier_jobs."subject_key" = ${event_jobs.queue_key}
        and barrier_jobs."job_status" = 'queued'
        and barrier_jobs."available_time" > ${now.toISOString()}::timestamptz
        and barrier_jobs."metadata" ->> ${event_job_queue_barrier_metadata_key} = 'true'
    )`,
    workspace_has_room_for_another_run_condition(now),
  ];
  return input.workspace_id
    ? and(eq(event_jobs.workspace_id, input.workspace_id), ...conditions)
    : and(...conditions);
}
