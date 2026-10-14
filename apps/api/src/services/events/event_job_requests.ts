import { randomUUID } from 'node:crypto';
import { recover_stuck_jobs_and_run_ready_queues } from '@api/services/events/event_job_recovery';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  list_ready_event_job_queues,
  run_next_ready_queue_jobs,
  run_queue_jobs,
  start_event_job_request,
} from '@coworker/jobs';
import { find_event_job_handler } from '@coworker/runtime-platform';
import { create_logger } from '@coworker/shared';

const log = create_logger('event_job_recovery');

export type QueueEventJobRequest = {
  workspace_id: string;
  queue_key: string;
  delay_ms?: number | undefined;
};

const running_event_job_requests = new Set<Promise<void>>();

export function begin_event_job_request() {
  let finish_promise: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish_promise = resolve;
  });
  running_event_job_requests.add(finished);

  let finished_once = false;
  return () => {
    if (finished_once) return;
    finished_once = true;
    running_event_job_requests.delete(finished);
    finish_promise();
  };
}

export async function run_tracked_event_job_request<T>(run_request: () => Promise<T>) {
  const finish_request = begin_event_job_request();
  try {
    return await run_request();
  } finally {
    finish_request();
  }
}

export async function wait_for_event_job_requests_to_finish() {
  await Promise.allSettled([...running_event_job_requests]);
}

export async function run_requested_event_jobs(
  db: Database,
  job_request: QueueEventJobRequest | Record<string, never>,
) {
  const worker_id = `run_queued_jobs_route:${randomUUID()}`;
  const result =
    'workspace_id' in job_request
      ? await run_queue_jobs(
          db,
          {
            workspace_id: job_request.workspace_id,
            queue_key: job_request.queue_key,
            worker_id,
          },
          find_event_job_handler,
        )
      : await run_next_ready_queue_jobs(db, { worker_id }, find_event_job_handler);

  if (result.ran_jobs) await start_event_job_request();
  return { ran_jobs: result.ran_jobs, job_count: result.event_jobs.length };
}

export async function recover_event_jobs_and_start_requests(db: Database) {
  const repaired = await recover_stuck_jobs_and_run_ready_queues(db, {
    worker_id_prefix: 'run_queued_jobs_recovery',
    max_queue_runs: 0,
  });
  const ready_queues = await list_ready_event_job_queues(db, {
    limit: env.WORKER_RECOVERY_DISPATCH_CONCURRENCY,
  });
  const dispatches = await Promise.all(ready_queues.map((queue) => start_event_job_request(queue)));

  const summary = {
    recovered_jobs: repaired.recovered_jobs,
    recovered_runs: repaired.recovered_runs,
    run_requests_sent: dispatches.filter(Boolean).length,
  };

  const swept_something =
    summary.recovered_jobs > 0 || summary.recovered_runs > 0 || summary.run_requests_sent > 0;
  const sentence = `recovery sweep: recovered ${summary.recovered_jobs} stuck job(s), ${summary.recovered_runs} run(s); dispatched ${summary.run_requests_sent} ready queue(s)`;
  if (swept_something) log.info(sentence);
  else log.debug(sentence);

  return summary;
}
