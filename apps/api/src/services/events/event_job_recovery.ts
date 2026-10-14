import { randomUUID } from 'node:crypto';
import type { Database } from '@coworker/core';
import { expire_stale_pending_connection_setups } from '@coworker/core/db/queries/connection_management';
import { recover_stale_running_runs } from '@coworker/core/db/queries/sessions';
import {
  recover_expired_event_jobs,
  run_next_ready_queue_jobs,
  run_queue_jobs,
} from '@coworker/jobs';
import { start_resumes_for_expired_connection_setups } from '@runtime-platform/connections/connection_resume_activation';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';

const recovery_batch_limit = 25;
const recovery_worker_id_prefix = `event_recovery:${randomUUID()}`;

export async function recover_stuck_jobs_and_run_ready_queues(
  db: Database,
  input: {
    worker_id_prefix?: string;
    max_queue_runs?: number;
  } = {},
) {
  const new_worker_id = () =>
    `${input.worker_id_prefix ?? recovery_worker_id_prefix}:${randomUUID()}`;
  const max_queue_runs = input.max_queue_runs ?? recovery_batch_limit;
  const recovered_jobs = await recover_expired_event_jobs(db);
  const recovered_runs = await recover_stale_running_runs(db);
  const expired_connection_setups = await expire_stale_pending_connection_setups(db);
  await start_resumes_for_expired_connection_setups(db, expired_connection_setups);

  let queues_ran = 0;
  let jobs_ran = 0;

  const recovered_queues = unique_recovered_queues(recovered_jobs).slice(0, max_queue_runs);
  const recovered_queue_results = await Promise.all(
    recovered_queues.map((queue) =>
      run_queue_jobs(db, { ...queue, worker_id: new_worker_id() }, find_event_job_handler),
    ),
  );
  const recovered_totals = count_event_job_results(recovered_queue_results);
  queues_ran += recovered_totals.queues_ran;
  jobs_ran += recovered_totals.jobs_ran;

  const ready_queue_results = await Promise.all(
    Array.from({ length: Math.max(max_queue_runs - queues_ran, 0) }, () =>
      run_next_ready_queue_jobs(db, { worker_id: new_worker_id() }, find_event_job_handler),
    ),
  );
  const ready_totals = count_event_job_results(ready_queue_results);
  queues_ran += ready_totals.queues_ran;
  jobs_ran += ready_totals.jobs_ran;

  return {
    recovered_jobs: recovered_jobs.length,
    recovered_runs: recovered_runs.length,
    expired_connection_setups: expired_connection_setups.length,
    queues_ran,
    jobs_ran,
    capped: queues_ran === max_queue_runs,
  };
}

function count_event_job_results(
  results: Array<{ ran_jobs: boolean; event_jobs: Array<unknown> }>,
) {
  return results.reduce(
    (totals, result) => ({
      queues_ran: totals.queues_ran + (result.ran_jobs ? 1 : 0),
      jobs_ran: totals.jobs_ran + (result.ran_jobs ? result.event_jobs.length : 0),
    }),
    { queues_ran: 0, jobs_ran: 0 },
  );
}

function unique_recovered_queues(jobs: Array<{ workspace_id: string; queue_key: string }>) {
  const queues = new Map<string, { workspace_id: string; queue_key: string }>();
  for (const job of jobs) {
    queues.set(`${job.workspace_id}:${job.queue_key}`, {
      workspace_id: job.workspace_id,
      queue_key: job.queue_key,
    });
  }
  return [...queues.values()];
}
