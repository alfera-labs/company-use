import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { task_is_of_person } from '@coworker/core/db/queries/task_people';
import { api_keys, event_jobs, events, runs, sessions, triggers } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

type RemovedMember = { workspace_id: string; user_id: string; actor_id: string };

const run_statuses_still_going = ['queued', 'starting', 'running', 'waiting'];

/**
 * Revokes every live API key a person made in a workspace, and says how many. A key acts with
 * the workspace's reach and no session, so it would outlive the person who made it.
 */
export async function revoke_api_keys_made_by(
  db: DatabaseExecutor,
  input: RemovedMember,
): Promise<number> {
  const revoked = await db
    .update(api_keys)
    .set({ revoked_time: sql`now()`, ...updated_by(input.actor_id) })
    .where(
      and(
        eq(api_keys.workspace_id, input.workspace_id),
        eq(api_keys.created_by, input.user_id),
        isNull(api_keys.revoked_time),
      ),
    )
    .returning({ api_key_id: api_keys.api_key_id });
  return revoked.length;
}

/**
 * Switches off every scheduled task a person made or was the last to change, and names them.
 * A task keeps starting work on the clock with nobody signed in, so it would go on working
 * with the instruction of a person who is out.
 */
export async function disable_scheduled_tasks_of(
  db: DatabaseExecutor,
  input: RemovedMember,
): Promise<string[]> {
  const disabled = await db
    .update(triggers)
    .set({ trigger_status: 'disabled', ...updated_by(input.actor_id) })
    .where(
      and(
        eq(triggers.workspace_id, input.workspace_id),
        eq(triggers.trigger_type, 'schedule'),
        eq(triggers.trigger_status, 'enabled'),
        task_is_of_person(input.user_id),
      ),
    )
    .returning({ trigger_name: triggers.trigger_name });
  return disabled.map((trigger) => trigger.trigger_name);
}

function keys_made_by(db: DatabaseExecutor, input: { workspace_id: string; user_id: string }) {
  return db
    .select({ api_key_id: api_keys.api_key_id })
    .from(api_keys)
    .where(
      and(eq(api_keys.workspace_id, input.workspace_id), eq(api_keys.created_by, input.user_id)),
    );
}

/**
 * Takes back every message of a person that has not started a run yet, in any chat: the ones
 * they sent, and the ones sent with a key they made. A message waits behind the run before
 * it, so stopping that run alone would start the next message of a person who is out.
 */
export async function cancel_waiting_messages_of_person(
  db: DatabaseExecutor,
  input: RemovedMember & { message_job_handlers: string[] },
): Promise<number> {
  const events_of_person = db
    .select({ event_id: events.event_id })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        or(eq(events.actor_key, input.user_id), inArray(events.actor_key, keys_made_by(db, input))),
      ),
    );
  const cancelled = await db
    .update(event_jobs)
    .set({
      job_status: 'cancelled',
      result_data: sql`${event_jobs.result_data} || '{"cancelled_because":"sender_removed"}'::jsonb`,
      locked_by: null,
      locked_until: null,
      ...updated_by(input.actor_id),
    })
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        inArray(event_jobs.job_handler, input.message_job_handlers),
        inArray(event_jobs.job_status, ['queued', 'waiting']),
        inArray(event_jobs.event_id, events_of_person),
      ),
    )
    .returning({ job_id: event_jobs.job_id });
  return cancelled.length;
}

/**
 * The runs still going for a person: in the chats they started, in the chats started with a
 * key they made, and in the chats of the scheduled tasks they made or last changed. A task's
 * chat is started by the scheduler and a key's chat by the key, not by the person, so the
 * chat's own maker does not find them.
 */
export async function list_going_runs_of_person(
  db: DatabaseExecutor,
  input: { workspace_id: string; user_id: string },
): Promise<string[]> {
  const tasks_of_person = db
    .select({ trigger_id: triggers.trigger_id })
    .from(triggers)
    .where(and(eq(triggers.workspace_id, input.workspace_id), task_is_of_person(input.user_id)));
  const going = await db
    .select({ run_id: runs.run_id })
    .from(runs)
    .innerJoin(
      sessions,
      and(eq(sessions.workspace_id, runs.workspace_id), eq(sessions.session_id, runs.session_id)),
    )
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        inArray(runs.run_status, run_statuses_still_going),
        or(
          eq(sessions.created_by, input.user_id),
          inArray(sessions.created_by, keys_made_by(db, input)),
          inArray(runs.trigger_id, tasks_of_person),
        ),
      ),
    );
  return going.map((run) => run.run_id);
}
