import type { Database } from '@coworker/core';
import { EventJobClaimLostError } from '@coworker/jobs/event_job_claim_lost';
import { extend_event_job_lock } from '@coworker/jobs/queries/event_job_leases';
import { create_logger } from '@coworker/shared';

const log = create_logger('event_job_runner');
const lease_heartbeat_interval_ms = 20_000;

export type EventJobLease = ReturnType<typeof start_lease_heartbeat>;

type LeaseClaim = {
  workspace_id: string;
  worker_id: string;
  lock_token: string;
  event_jobs: Array<{ job_id: string }>;
};

type LeaseState = {
  claim: LeaseClaim;
  held_job_ids: Set<string>;
  abort_controller: AbortController;
  run_exclusively: ReturnType<typeof create_serial_operation_queue>;
  failure: Error | null;
};

export function start_lease_heartbeat(db: Database, claim: LeaseClaim) {
  const lease: LeaseState = {
    claim,
    held_job_ids: new Set(claim.event_jobs.map((job) => job.job_id)),
    abort_controller: new AbortController(),
    run_exclusively: create_serial_operation_queue(),
    failure: null,
  };
  const heartbeat = () => extend_held_jobs(db, lease);
  const timer = start_heartbeat_timer(lease, heartbeat);
  return {
    heartbeat,
    signal: lease.abort_controller.signal,
    write_while_held: <Row>(operation: string, job_ids: string[], write: () => Promise<Row[]>) =>
      write_checked(lease, operation, () => job_ids, write),
    write_and_let_go: <Row>(operation: string, job_ids: string[], write: () => Promise<Row[]>) =>
      write_checked(
        lease,
        operation,
        () => job_ids,
        write,
        (ids) => let_go(lease, ids),
      ),
    throw_if_failed: () => {
      if (lease.failure) throw lease.failure;
    },
    stop: () => clearInterval(timer),
  };
}

async function extend_held_jobs(db: Database, lease: LeaseState) {
  await write_checked(
    lease,
    'extending the lease',
    () => [...lease.held_job_ids],
    (job_ids) =>
      extend_event_job_lock(db, {
        workspace_id: lease.claim.workspace_id,
        lock_token: lease.claim.lock_token,
        job_ids,
      }),
  );
}

function start_heartbeat_timer(lease: LeaseState, heartbeat: () => Promise<void>) {
  const timer = setInterval(() => {
    void heartbeat().catch((error) => {
      if (error instanceof EventJobClaimLostError) return;
      lease.failure ??= error instanceof Error ? error : new Error(String(error));
      log.error('Event-job lease heartbeat failed', {
        workspace_id: lease.claim.workspace_id,
        worker_id: lease.claim.worker_id,
        error: lease.failure.message,
      });
    });
  }, lease_heartbeat_interval_ms);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

function write_checked<Row>(
  lease: LeaseState,
  operation: string,
  read_job_ids: () => string[],
  write: (job_ids: string[]) => Promise<Row[]>,
  after_write: (job_ids: string[]) => void = () => undefined,
) {
  return lease.run_exclusively(async () => {
    const job_ids = read_job_ids();
    if (job_ids.length === 0) return [];
    const changed_rows = await write(job_ids);
    if (changed_rows.length !== job_ids.length) {
      lose_claim(lease, new EventJobClaimLostError(operation, job_ids, changed_rows.length));
    }
    after_write(job_ids);
    return changed_rows;
  });
}

function lose_claim(lease: LeaseState, error: EventJobClaimLostError): never {
  lease.failure ??= error;
  if (!lease.abort_controller.signal.aborted) lease.abort_controller.abort(error);
  throw error;
}

function let_go(lease: LeaseState, job_ids: string[]) {
  for (const job_id of job_ids) lease.held_job_ids.delete(job_id);
}

export function create_serial_operation_queue() {
  let pending_operation = Promise.resolve();
  return <Result>(operation: () => Promise<Result>) => {
    const result = pending_operation.then(operation);
    pending_operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
