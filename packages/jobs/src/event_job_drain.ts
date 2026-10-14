import { randomUUID } from 'node:crypto';
import type { Database } from '@coworker/core';
import type { FindEventJobHandler, LiveEventPublisher } from '@coworker/jobs/event_job_handler';
import { run_queue_jobs } from '@coworker/jobs/event_job_runner';

export const queue_worker_lock_prefix = 'queue_worker:';

type DrainInput = {
  workspace_id: string;
  queue_key: string;
  worker_id_prefix: string;
  live_events?: LiveEventPublisher | undefined;
};

export function drain_queue_jobs(
  db: Database,
  input: DrainInput,
  find_event_job_handler: FindEventJobHandler,
) {
  return run_batches_until_queue_is_empty(db, input, find_event_job_handler, []);
}

async function run_batches_until_queue_is_empty(
  db: Database,
  input: DrainInput,
  find_event_job_handler: FindEventJobHandler,
  job_ids: string[],
): Promise<string[]> {
  const result = await run_queue_jobs(
    db,
    {
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      worker_id: `${input.worker_id_prefix}:${randomUUID()}`,
      live_events: input.live_events,
      caller_claims_again: true,
    },
    find_event_job_handler,
  );
  if (!result.ran_jobs) return job_ids;
  job_ids.push(...result.event_jobs.map((job) => job.job_id));
  return run_batches_until_queue_is_empty(db, input, find_event_job_handler, job_ids);
}
