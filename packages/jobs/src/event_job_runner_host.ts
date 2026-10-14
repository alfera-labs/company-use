import { uses_rivet_event_job_dispatch } from '@coworker/jobs/event_job_doorbell';

let this_process_is_a_queue_worker = false;

export function mark_this_process_as_queue_worker() {
  this_process_is_a_queue_worker = true;
}

export class JobRunOutsideQueueWorkerError extends Error {
  readonly code = 'job_run_outside_queue_worker';

  constructor() {
    super(
      'EVENT_JOB_DISPATCH_MODE=rivet: only a queue worker on Rivet runs jobs. This process may queue a job and ring its queue worker, but it may not claim or run one.',
    );
    this.name = 'JobRunOutsideQueueWorkerError';
  }
}

export function refuse_job_runs_outside_the_queue_worker() {
  if (!uses_rivet_event_job_dispatch() || this_process_is_a_queue_worker) return;
  throw new JobRunOutsideQueueWorkerError();
}
