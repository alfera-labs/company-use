import type { Database } from '@coworker/core';
import { record_trigger_fired } from '@coworker/core/db/queries/trigger_scheduling';
import type { EventRawPayloadData } from '@coworker/core/db/schema/json_column_types';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import { find_automation_fire_keys } from '@runtime-platform/automations/automation_subject';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import {
  prepare_trigger_fire_event,
  type TriggerFireDelivery,
  type TriggerRow,
} from '@runtime-platform/events/trigger_ingress';

export type FiredTrigger = {
  fired: boolean;
  trigger_id: string;
  event_id: string;
  queued_job_count: number;
  event_job_ids: string[];
};

export async function fire_trigger(
  db: Database,
  trigger: TriggerRow,
  options: {
    occurrence_key: string;
    delivery?: TriggerFireDelivery | undefined;
    raw_payload?: EventRawPayloadData | undefined;
  },
): Promise<FiredTrigger | null> {
  const keys = await find_automation_fire_keys(db, trigger, options);
  const prepared = prepare_trigger_fire_event(trigger, {
    ...options,
    ...(keys ? { queue_key: keys.queue_key } : {}),
  });
  if (!prepared) return null;

  const result = await queue_and_run_event_jobs(db, prepared.event, find_event_job_handler);
  if (result.created) {
    await record_trigger_fired(db, {
      workspace_id: trigger.workspace_id,
      trigger_id: trigger.trigger_id,
    });
  }

  return {
    fired: result.created,
    trigger_id: trigger.trigger_id,
    event_id: result.event.event_id,
    queued_job_count: result.event_jobs.length,
    event_job_ids: result.event_jobs.map((job) => job.job_id),
  };
}
