import type { Database } from '@coworker/core';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import type { EventJobHandlerResult } from '@coworker/jobs';
import type { AutomationFire } from '@runtime-platform/automations/automation_fire';
import {
  read_session_key_from_queue_key,
  read_subject_value_from_session_key,
} from '@runtime-platform/automations/automation_subject';
import type { Automation } from '@runtime-platform/automations/start_automation_run';
import {
  triage_signal_job_handler,
  triage_signal_source,
} from '@runtime-platform/events/triage_signal_job';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';

export async function enqueue_triage_for_dropped_fire(
  db: Database,
  input: {
    workspace_id: string;
    queue_key?: string | undefined;
    automation: Automation;
    trigger: TriggerRow;
    fire: AutomationFire;
    fire_event_id: string;
    result: EventJobHandlerResult;
  },
): Promise<boolean> {
  const stage = read_dropped_stage(input.result);
  const data = input.fire.delivery?.data;
  if (!stage || !data) return false;

  const subject = read_subject(input.queue_key, input.fire);
  await enqueue_event_jobs(db, {
    workspace_id: input.workspace_id,
    source: triage_signal_source,
    source_event_id: input.fire_event_id,
    event_type: 'signal.triage',
    queue_key: `triage:${input.workspace_id}:${subject}`,
    actor_key: 'system:triage',
    event_body: {
      kind: 'triage_signal',
      agent_id: input.automation.agent_id,
      automation_id: input.automation.automation_id,
      trigger_id: input.trigger.trigger_id,
      stage,
      fire_event_id: input.fire_event_id,
      data,
    },
    event_jobs: [{ job_handler: triage_signal_job_handler }],
  });
  return true;
}

function read_dropped_stage(result: EventJobHandlerResult): 'judge' | 'listen' | null {
  const skipped = (result.result_data as { skipped?: { stage?: unknown } } | undefined)?.skipped;
  const stage = skipped?.stage;
  return stage === 'judge' || stage === 'listen' ? stage : null;
}

function read_subject(queue_key: string | undefined, fire: AutomationFire): string {
  const session_key = queue_key ? read_session_key_from_queue_key(queue_key) : null;
  const subject = session_key ? read_subject_value_from_session_key(session_key) : null;
  return subject ?? fire.occurrence_key;
}
