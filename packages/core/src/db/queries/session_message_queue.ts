import type { Database } from '@coworker/core/db/connection';
import { event_jobs, sessions } from '@coworker/core/db/schema';
import {
  session_agent_message_job_handler,
  session_queue_key,
  session_queue_resumed_event_type,
} from '@coworker/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

const not_started_statuses = ['queued', 'waiting'] as const;

export function session_message_jobs(workspace_id: string, session_id: string) {
  return and(
    eq(event_jobs.workspace_id, workspace_id),
    eq(event_jobs.queue_key, session_queue_key(session_id)),
    eq(event_jobs.job_handler, session_agent_message_job_handler),
  );
}

export function list_waiting_session_messages(
  db: Database,
  input: { workspace_id: string; session_id: string },
) {
  return db
    .select({
      job_id: event_jobs.job_id,
      job_status: event_jobs.job_status,
      run_id: event_jobs.run_id,
      attempt_count: event_jobs.attempt_count,
      available_time: event_jobs.available_time,
      created_time: event_jobs.created_time,
      metadata: event_jobs.metadata,
      result_data: event_jobs.result_data,
      error_data: event_jobs.error_data,
    })
    .from(event_jobs)
    .where(
      and(
        session_message_jobs(input.workspace_id, input.session_id),
        inArray(event_jobs.job_status, [...not_started_statuses]),
      ),
    )
    .orderBy(asc(event_jobs.created_time), asc(event_jobs.job_id));
}

export async function is_session_busy(
  db: Database,
  input: { workspace_id: string; session_id: string },
) {
  const [row] = await db
    .select({
      has_running_job: sql<boolean>`exists (
        select 1 from ${event_jobs}
        where ${event_jobs.workspace_id} = ${input.workspace_id}
          and ${event_jobs.queue_key} = ${session_queue_key(input.session_id)}
          and ${event_jobs.job_status} = 'running'
      )`,
      locked_by_run_id: sessions.locked_by_run_id,
      lock_expires_time: sessions.lock_expires_time,
    })
    .from(sql`(select 1) as busy_probe`)
    .leftJoin(
      sessions,
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    );
  if (row?.has_running_job) return true;
  if (!row?.locked_by_run_id) return false;
  return !row.lock_expires_time || row.lock_expires_time > new Date();
}

export async function find_session_message_job(
  db: Database,
  input: { workspace_id: string; session_id: string; job_id: string },
) {
  const job = await db.query.event_jobs.findFirst({
    where: and(
      session_message_jobs(input.workspace_id, input.session_id),
      eq(event_jobs.job_id, input.job_id),
    ),
  });
  return job ?? null;
}

export async function cancel_waiting_session_message(
  db: Database,
  input: { workspace_id: string; session_id: string; job_id: string; actor_id: string },
) {
  const [cancelled] = await db
    .update(event_jobs)
    .set(cancelled_job_values(input.actor_id, 'removed'))
    .where(
      and(
        session_message_jobs(input.workspace_id, input.session_id),
        eq(event_jobs.job_id, input.job_id),
        inArray(event_jobs.job_status, [...not_started_statuses]),
      ),
    )
    .returning();
  return cancelled ?? null;
}

export function cancel_all_waiting_session_messages(
  db: Database,
  input: { workspace_id: string; session_id: string; actor_id: string },
) {
  return db
    .update(event_jobs)
    .set(cancelled_job_values(input.actor_id, 'session_archived'))
    .where(
      and(
        session_message_jobs(input.workspace_id, input.session_id),
        inArray(event_jobs.job_status, [...not_started_statuses]),
      ),
    )
    .returning({ job_id: event_jobs.job_id });
}

export function pause_queued_session_messages(
  db: Database,
  input: { workspace_id: string; session_id: string; actor_id: string },
) {
  return db
    .update(event_jobs)
    .set({
      job_status: 'waiting',
      awaits_event_type: session_queue_resumed_event_type,
      awaits_queue_key: session_queue_key(input.session_id),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        session_message_jobs(input.workspace_id, input.session_id),
        eq(event_jobs.job_status, 'queued'),
      ),
    )
    .returning({ job_id: event_jobs.job_id });
}

function cancelled_job_values(actor_id: string, cancelled_because: string) {
  return {
    job_status: 'cancelled',
    result_data: sql`${event_jobs.result_data} || ${JSON.stringify({ cancelled_because })}::jsonb`,
    locked_by: null,
    locked_until: null,
    last_updated_time: new Date(),
    last_updated_by: actor_id,
  };
}
