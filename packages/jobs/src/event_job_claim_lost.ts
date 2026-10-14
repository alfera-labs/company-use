import { create_logger } from '@coworker/shared';

const log = create_logger('event_job_runner');

export class EventJobClaimLostError extends Error {
  override readonly name = 'EventJobClaimLostError';

  constructor(
    public readonly operation: string,
    public readonly job_ids: string[],
    public readonly changed_count: number,
  ) {
    super(
      `Event-job claim was lost while ${operation}: ${changed_count} of ${job_ids.length} jobs changed.`,
    );
  }
}

export function require_claim_still_held(
  operation: string,
  job_ids: string[],
  changed_rows: readonly unknown[],
) {
  if (changed_rows.length === job_ids.length) return;
  throw new EventJobClaimLostError(operation, job_ids, changed_rows.length);
}

export function log_lost_event_job_claim(
  error: EventJobClaimLostError,
  context: { workspace_id: string; queue_key: string; worker_id: string; lock_token: string },
) {
  log.warn('event_job_claim_lost', {
    ...context,
    operation: error.operation,
    job_ids: error.job_ids,
    changed_count: error.changed_count,
  });
}
