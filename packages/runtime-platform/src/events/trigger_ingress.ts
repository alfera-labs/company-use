import type { EnqueueEventInput } from '@coworker/core/db/queries/events';
import type { triggers } from '@coworker/core/db/schema';
import type { EventRawPayloadData } from '@coworker/core/db/schema/json_column_types';

export type TriggerRow = typeof triggers.$inferSelect;

export type TriggerFireDelivery = {
  provider: string;
  trigger_slug: string;
  received_time: string;
  data: Record<string, unknown>;
};

export type PreparedTriggerFire = {
  event: EnqueueEventInput;
  queue_key: string;
};

export function prepare_trigger_fire_event(
  trigger: TriggerRow,
  options: {
    occurrence_key: string;
    delivery?: TriggerFireDelivery | undefined;
    raw_payload?: EventRawPayloadData | undefined;
    queue_key?: string | undefined;
  },
): PreparedTriggerFire | null {
  const config = trigger.trigger_config;
  const job_handler = config?.starts_job_handler;
  if (!job_handler) return null;

  const queue_key = options.queue_key ?? `trigger:${trigger.trigger_id}`;
  return {
    queue_key,
    event: {
      workspace_id: trigger.workspace_id,
      source: 'trigger',
      source_event_id: `${trigger.trigger_id}:${options.occurrence_key}`,
      event_type: 'trigger.fired',
      queue_key,
      actor_key: 'system:trigger',
      event_body: {
        trigger_id: trigger.trigger_id,
        ...(config.job_input ?? {}),
        ...(options.delivery ? { delivery: options.delivery } : {}),
      },
      ...(options.raw_payload ? { raw_payload: options.raw_payload } : {}),
      event_jobs: [{ job_handler }],
    },
  };
}

export type TriggerSchedule = {
  trigger_id: string;
  cron_expression: string;
  timezone?: string;
  run_once_at?: string;
};

export function read_trigger_schedule(trigger: TriggerRow): TriggerSchedule | null {
  if (trigger.trigger_type !== 'schedule' || !trigger.schedule_expression) return null;
  const config = trigger.trigger_config;
  const timezone = config?.timezone;
  const run_once_at = config?.run_once_at;
  return {
    trigger_id: trigger.trigger_id,
    cron_expression: trigger.schedule_expression,
    ...(timezone ? { timezone } : {}),
    ...(run_once_at ? { run_once_at } : {}),
  };
}
