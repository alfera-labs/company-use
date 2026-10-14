import type { Database } from '@coworker/core/db/connection';
import { session_message_jobs } from '@coworker/core/db/queries/session_message_queue';
import { event_jobs, events } from '@coworker/core/db/schema';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

const ended_statuses = ['done', 'failed', 'dead'] as const;
export const not_sent_messages_shown_for_ms = 15 * 60 * 1000;

function ended_without_a_run(workspace_id: string, session_id: string) {
  return and(
    session_message_jobs(workspace_id, session_id),
    inArray(event_jobs.job_status, [...ended_statuses]),
    isNull(event_jobs.run_id),
    sql`coalesce((${event_jobs.metadata} ->> 'dismissed_by_user')::boolean, false) = false`,
  );
}

export function list_session_messages_not_sent(
  db: Database,
  input: { workspace_id: string; session_id: string; now?: Date },
) {
  const shown_since = new Date(
    (input.now ?? new Date()).getTime() - not_sent_messages_shown_for_ms,
  );
  return db
    .select({
      job_id: event_jobs.job_id,
      job_status: event_jobs.job_status,
      created_time: event_jobs.created_time,
      metadata: event_jobs.metadata,
      result_data: event_jobs.result_data,
      error_data: event_jobs.error_data,
      event_body: events.event_body,
    })
    .from(event_jobs)
    .leftJoin(
      events,
      and(
        eq(events.workspace_id, event_jobs.workspace_id),
        eq(events.event_id, event_jobs.event_id),
      ),
    )
    .where(
      and(
        ended_without_a_run(input.workspace_id, input.session_id),
        gte(event_jobs.last_updated_time, shown_since),
      ),
    )
    .orderBy(asc(event_jobs.created_time), asc(event_jobs.job_id));
}

export async function dismiss_session_message_not_sent(
  db: Database,
  input: { workspace_id: string; session_id: string; job_id: string; actor_id: string },
) {
  const [dismissed] = await db
    .update(event_jobs)
    .set({
      metadata: sql`${event_jobs.metadata} || '{"dismissed_by_user": true}'::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        ended_without_a_run(input.workspace_id, input.session_id),
        eq(event_jobs.job_id, input.job_id),
      ),
    )
    .returning();
  return dismissed ?? null;
}
