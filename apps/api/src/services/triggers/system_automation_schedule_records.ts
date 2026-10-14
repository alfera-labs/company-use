import { add_schedule_jitter, type triggers } from '@coworker/core';
import type { TriggerConfigData } from '@coworker/core/db/schema/json_column_types';

type TriggerRow = typeof triggers.$inferSelect;

export type SystemAutomationSchedule = {
  provisioning_key: string;
  trigger_name: string;
  starts_job_handler: string;
  purpose: string;
  fires: { every_minutes: number } | { cron_expression: string };
};

export const system_automation_schedules: SystemAutomationSchedule[] = [
  {
    provisioning_key: 'attention_tick_v1',
    trigger_name: 'Attention tick',
    starts_job_handler: 'run_attention_tick',
    purpose: 'attention_tick',
    fires: { every_minutes: 15 },
  },
];

const retired_provisioning_keys = new Set([
  'daily_summary_v1',
  'automation_watchdog_v1',
  'calendar_offset_sweep_v1',
  'automation_miner_v1',
  'memory_nightly_v1',
]);

export function build_config(
  schedule: SystemAutomationSchedule,
  timezone: string,
): TriggerConfigData {
  return {
    starts_job_handler: schedule.starts_job_handler,
    timezone,
    provisioning_key: schedule.provisioning_key,
  };
}

export function is_retired_system_schedule(trigger: TriggerRow) {
  const key = trigger.trigger_config?.provisioning_key;
  return (
    trigger.trigger_type === 'schedule' &&
    typeof key === 'string' &&
    retired_provisioning_keys.has(key)
  );
}

export function matches_schedule(trigger: TriggerRow, schedule: SystemAutomationSchedule) {
  return (
    trigger.trigger_type === 'schedule' &&
    trigger.trigger_config?.provisioning_key === schedule.provisioning_key
  );
}

export function schedule_expression_of(workspace_id: string, schedule: SystemAutomationSchedule) {
  if ('every_minutes' in schedule.fires) {
    return spread_across_the_hour(workspace_id, schedule.fires.every_minutes);
  }
  return add_schedule_jitter({
    cron_expression: schedule.fires.cron_expression,
    workspace_id,
    window: 'small_window',
  });
}

function spread_across_the_hour(workspace_id: string, every_minutes: number) {
  const jittered = add_schedule_jitter({
    cron_expression: '0 * * * *',
    workspace_id,
    window: 'full_hour',
  });
  const offset = Number(jittered.split(' ')[0] ?? '0') % every_minutes;
  const minutes: number[] = [];
  for (let minute = offset; minute < 60; minute += every_minutes) minutes.push(minute);
  return `${minutes.join(',')} * * * *`;
}
