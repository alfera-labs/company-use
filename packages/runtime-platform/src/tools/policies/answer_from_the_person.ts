import type { Database } from '@coworker/core';
import { approval_wake_channel } from '@coworker/core/db/queries/approval_answers';
import { policy_decision_event_type } from '@coworker/core/db/queries/event_waits';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { announce_wake } from '@coworker/core/db/wake_channel';
import { run_queue_jobs_in_the_background } from '@coworker/jobs';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';

export type PersonsAnswer = {
  workspace_id: string;
  job_id: string;
  queue_key: string;
  decided_by: string;
  decision: 'approved' | 'denied';
  reason?: string | undefined;
};

export async function record_the_answer(db: Database, input: PersonsAnswer) {
  const result = await enqueue_event_jobs(db, {
    workspace_id: input.workspace_id,
    source: 'policy',
    source_event_id: `${input.job_id}:decision`,
    event_type: policy_decision_event_type,
    queue_key: input.queue_key,
    actor_key: input.decided_by,
    event_body: { job_id: input.job_id, decision: input.decision, reason: input.reason },
  });

  const approval_job = result.event_jobs.find((event_job) => event_job.job_id === input.job_id);
  if (!approval_job) return null;

  await announce_wake(db, approval_wake_channel, input.job_id);
  run_queue_jobs_in_the_background(
    db,
    { workspace_id: input.workspace_id, queue_key: approval_job.queue_key },
    find_event_job_handler,
  );

  return { event: result.event, approval: approval_job };
}
