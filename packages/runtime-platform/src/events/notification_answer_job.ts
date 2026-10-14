import type { Database, event_jobs, events } from '@coworker/core';
import { record_platform_user_as_speaker } from '@coworker/core/db/queries/session_speakers';
import { get_session } from '@coworker/core/db/queries/sessions';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import { session_queue_key } from '@coworker/shared';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { find_finished_event_job_run } from '@runtime-platform/events/event_job_started_run';
import {
  read_agent_run_job,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { z } from 'zod';

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;

const notification_answer_event_type = 'notification.answered';

const yes_message = 'Yes, go ahead.';

const notification_answer_body_schema = z
  .object({
    notification_event_id: z.string().min(1),
    session_id: z.string().min(1),
    answered_by: z.string().min(1),
    answer: z.literal('yes'),
  })
  .strict();

type NotificationAnswer = z.infer<typeof notification_answer_body_schema>;

export async function enqueue_notification_answer(
  db: Database,
  input: { workspace_id: string } & NotificationAnswer,
) {
  const session = await get_session(db, input.workspace_id, input.session_id);
  if (!session) return { enqueued: false, reason: 'answer_session_missing' };

  const queue_key = session.external_thread_key ?? session_queue_key(session.session_id);
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id: input.workspace_id,
      source: 'notification',
      source_event_id: `${input.notification_event_id}:answer`,
      event_type: notification_answer_event_type,
      queue_key,
      actor_key: input.answered_by,
      event_body: {
        notification_event_id: input.notification_event_id,
        session_id: input.session_id,
        answered_by: input.answered_by,
        answer: input.answer,
      },
      event_jobs: [{ job_handler: 'notification_answer' }],
    },
    find_event_job_handler,
  );
  const enqueued = result.event_jobs.length > 0;
  return { enqueued, reason: enqueued ? 'answer_enqueued' : 'answer_deduped', queue_key };
}

export async function run_notification_answer_job(input: {
  db: Database;
  workspace_id: string;
  event_jobs?: EventJob[];
  events: EventRecord[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
}): Promise<EventJobHandlerResult> {
  const answer = read_latest_answer(input.events);
  if (!answer) {
    return { job_status: 'done', result_data: { answered: false, code: 'answer_unreadable' } };
  }

  const finished_run = await find_finished_event_job_run(input.db, {
    workspace_id: input.workspace_id,
    event_jobs: input.event_jobs ?? [],
    include_failed_with_progress: true,
  });
  if (finished_run) {
    const failed = finished_run.run_status === 'failed';
    return {
      job_status: 'done',
      run_id: finished_run.run_id,
      result_data: { reused: true, ...(failed ? { recovered_started_run: true, failed } : {}) },
    };
  }

  const source_actor = await record_platform_user_as_speaker(input.db, {
    workspace_id: input.workspace_id,
    session_id: answer.session_id,
    user_id: answer.answered_by,
  });
  const run = await start_agent_run_for_job(
    input.db,
    {
      workspace_id: input.workspace_id,
      session_id: answer.session_id,
      user_message: yes_message,
      actor_id: answer.answered_by,
      user_message_source_metadata: { source_actor },
    },
    read_agent_run_job(input),
  );
  return { job_status: 'done', run_id: run.run_id, result_data: { run_id: run.run_id } };
}

function read_latest_answer(records: EventRecord[]): NotificationAnswer | null {
  const latest = records
    .filter((record) => record.event_type === notification_answer_event_type)
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime())
    .at(-1);
  if (!latest) return null;
  const parsed = notification_answer_body_schema.safeParse(latest.event_body);
  return parsed.success ? parsed.data : null;
}
