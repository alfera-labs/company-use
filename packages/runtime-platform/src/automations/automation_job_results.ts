import type { EventJobHandlerResult } from '@coworker/jobs';
import type { RunDecision } from '@runtime-platform/automations/decide_whether_to_run';
import type { Automation } from '@runtime-platform/automations/start_automation_run';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';

export function nothing_to_run(
  message: string,
  code = 'no_trigger',
  details: Record<string, unknown> = {},
): EventJobHandlerResult {
  return { job_status: 'done', result_data: { ran: false, code, message, ...details } };
}

export function ran_result(
  automation: Pick<Automation, 'automation_id'>,
  trigger: TriggerRow,
  details: Record<string, unknown> & { run_id: string },
): EventJobHandlerResult {
  return {
    job_status: 'done',
    run_id: details.run_id,
    result_data: {
      automation_id: automation.automation_id,
      trigger_id: trigger.trigger_id,
      ran: true,
      ...details,
    },
  };
}

export function skipped(
  automation: Automation,
  trigger: TriggerRow,
  skip: { stage: string; reason: string } | undefined,
  extra?: { verdict?: RunDecision['verdict']; subject_source?: string },
): EventJobHandlerResult {
  return {
    job_status: 'done',
    result_data: {
      automation_id: automation.automation_id,
      trigger_id: trigger.trigger_id,
      ran: false,
      ...(skip ? { skipped: skip } : {}),
      ...(extra?.verdict ? { judge: extra.verdict } : {}),
      ...(extra?.subject_source ? { subject_source: extra.subject_source } : {}),
    },
  };
}
