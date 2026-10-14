import type { AutomationTriggerInput } from '@/components/app/automations/automations_api';
import type { ScheduledTaskFrequency } from '@/components/app/scheduled_task_when_to_run';
import {
  cron_to_draft,
  default_schedule_draft,
  type ScheduleDraft,
} from '@/lib/schedule_builder_model';

export type SchedulePrefill = {
  frequency: ScheduledTaskFrequency;
  draft: ScheduleDraft;
  advanced_cron: string | null;
};

export const empty_schedule_prefill: SchedulePrefill = {
  frequency: 'every_day',
  draft: default_schedule_draft,
  advanced_cron: null,
};

export function schedule_prefill(input: AutomationTriggerInput): SchedulePrefill {
  if (input.kind !== 'schedule') return empty_schedule_prefill;
  const draft = cron_to_draft(input.cron);
  if (!draft) return { ...empty_schedule_prefill, frequency: 'custom', advanced_cron: input.cron };
  return { frequency: frequency_of(draft), draft, advanced_cron: null };
}

export function event_prefill(input: AutomationTriggerInput): Record<string, string | boolean> {
  if (input.kind !== 'app_event') return {};
  const answers: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(input.subscription_config ?? {})) {
    if (typeof value === 'boolean') answers[name] = value;
    else if (typeof value === 'string' || typeof value === 'number') answers[name] = String(value);
  }
  return answers;
}

function frequency_of(draft: ScheduleDraft): ScheduledTaskFrequency {
  if (draft.frequency === 'daily') return 'every_day';
  if (draft.frequency === 'hourly') return 'every_hour';
  if (draft.frequency === 'interval') return 'interval';
  if (draft.frequency === 'monthly') return 'every_month';
  if (draft.frequency === 'weekly' && draft.weekdays.join(',') === '1,2,3,4,5')
    return 'every_weekday';
  if (draft.frequency === 'weekly' && draft.weekdays.length === 1) return 'every_week';
  return 'selected_days';
}
