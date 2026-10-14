import type { Database } from '@coworker/core';
import {
  choices_answer_event_type,
  choices_answer_wake_channel,
} from '@coworker/core/db/queries/choices_answers';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { announce_wake } from '@coworker/core/db/wake_channel';
import { run_queue_jobs_in_the_background } from '@coworker/jobs';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';

export type PersonsQuestionAnswer = {
  workspace_id: string;
  job_id: string;
  queue_key: string;
  answered_by: string;
  answer_text: string;
};

export async function record_the_choices_answer(db: Database, input: PersonsQuestionAnswer) {
  const result = await enqueue_event_jobs(db, {
    workspace_id: input.workspace_id,
    source: 'policy',
    source_event_id: `${input.job_id}:answer`,
    event_type: choices_answer_event_type,
    queue_key: input.queue_key,
    actor_key: input.answered_by,
    event_body: { job_id: input.job_id, answer_text: input.answer_text },
  });

  const question_job = result.event_jobs.find((event_job) => event_job.job_id === input.job_id);
  if (!question_job) return null;

  await announce_wake(db, choices_answer_wake_channel, input.job_id);
  run_queue_jobs_in_the_background(
    db,
    {
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
    },
    find_event_job_handler,
  );

  return { event: result.event, question: question_job };
}
