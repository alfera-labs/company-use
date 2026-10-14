import type { Database, event_jobs } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';

type EventJob = typeof event_jobs.$inferSelect;

export function hold_job_for_credit_top_up(input: {
  event_jobs: EventJob[];
  message: string;
  code: string;
  now?: Date;
}): EventJobHandlerResult {
  return {
    job_status: 'done',
    result_data: { dispatched: false, code: input.code, message: input.message },
  };
}

export async function job_is_still_waiting_for_credit(
  _db: Database,
  _input: { workspace_id: string; event_jobs: EventJob[] },
): Promise<boolean> {
  return false;
}
