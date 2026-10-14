import type { EventJobHandlerResult } from '@coworker/jobs';

export function completed_result(input: {
  trigger_id: string;
  session_id: string;
  run_id: string;
  observed_event_ids: string[];
  recovered_started_run: boolean;
}): EventJobHandlerResult {
  return {
    job_status: 'done',
    run_id: input.run_id,
    result_data: {
      ran: true,
      trigger_id: input.trigger_id,
      session_id: input.session_id,
      run_id: input.run_id,
      decision: 'agent_run_completed',
      observed_message_count: input.observed_event_ids.length,
      observed_event_ids: input.observed_event_ids,
      recovered_started_run: input.recovered_started_run,
    },
  };
}

export function skipped_result(
  message: string,
  code = 'scout_skipped',
  details?: Record<string, unknown>,
): EventJobHandlerResult {
  return { job_status: 'done', result_data: { ran: false, code, message, ...(details ?? {}) } };
}

export function failed_result(
  code: string,
  message: string,
  context?: Record<string, unknown>,
): EventJobHandlerResult {
  return {
    job_status: 'failed',
    error_data: { code, message, ...(context ?? {}) },
  };
}
