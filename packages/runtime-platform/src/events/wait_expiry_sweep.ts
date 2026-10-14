import type { Database } from '@coworker/core';
import { choices_answer_event_type } from '@coworker/core/db/queries/choices_answers';
import { policy_decision_event_type } from '@coworker/core/db/queries/event_waits';
import { list_expired_waits } from '@coworker/core/db/queries/run_suspension';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { wait_expiry_actor_id } from '@runtime-platform/events/policy_decision_step_closing';

const log = create_logger('wait_expiry_sweep');

export async function expire_overdue_waits(db: Database, input: { limit?: number } = {}) {
  const expired = await list_expired_waits(db, input);
  let refused = 0;

  for (const wait of expired) {
    const event_type = wait.awaits_event_type ?? policy_decision_event_type;
    try {
      await queue_and_run_event_jobs(
        db,
        {
          workspace_id: wait.workspace_id,
          source: 'policy',
          source_event_id: `${wait.job_id}:expired`,
          event_type,
          queue_key: wait.awaits_queue_key ?? wait.queue_key,
          actor_key: wait_expiry_actor_id,
          event_body: expiry_body(event_type, wait.job_id),
        },
        find_event_job_handler,
      );
      refused += 1;
    } catch (error) {
      log.error('refusing an overdue wait failed', {
        workspace_id: wait.workspace_id,
        job_id: wait.job_id,
        error: format_error_message(error),
      });
    }
  }

  return { found: expired.length, refused };
}

function expiry_body(event_type: string, job_id: string) {
  if (event_type === choices_answer_event_type) {
    return { job_id, expired: true, reason: 'Nobody answered in time.' };
  }
  return {
    job_id,
    decision: 'denied',
    reason: 'Nobody answered in time, so the step was refused.',
  };
}
