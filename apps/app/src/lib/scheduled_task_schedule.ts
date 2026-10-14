import type { Trigger } from '@/lib/api';

import { cron_to_draft, weekday_order } from '@/lib/schedule_builder_model';

type SchedulePreset = {
  id: 'daily_9am' | 'weekday_9am' | 'hourly' | 'weekly_monday_9am' | 'custom';
  label: string;
  cron: string;
};

const schedule_presets: SchedulePreset[] = [
  { id: 'daily_9am', label: 'Every day at 9:00', cron: '0 9 * * *' },
  { id: 'weekday_9am', label: 'Every weekday at 9:00', cron: '0 9 * * 1-5' },
  { id: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { id: 'weekly_monday_9am', label: 'Every Monday at 9:00', cron: '0 9 * * 1' },
  { id: 'custom', label: 'Custom (cron expression)', cron: '' },
];

const label_by_cron = new Map(
  schedule_presets.filter((preset) => preset.cron).map((preset) => [preset.cron, preset.label]),
);

export function describe_schedule(schedule_expression: string | null | undefined): string {
  const trimmed = schedule_expression?.trim();
  if (!trimmed) return 'No schedule';
  return label_by_cron.get(trimmed) ?? describe_schedule_draft(trimmed) ?? `Cron: ${trimmed}`;
}

const cron_field_ranges: ReadonlyArray<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7], // day of week (0 and 7 are both Sunday)
];

export function is_valid_cron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== cron_field_ranges.length) return false;
  return fields.every((field, index) => is_valid_cron_field(field, cron_field_ranges[index]));
}

function is_valid_cron_field(field: string, bounds: [number, number] | undefined): boolean {
  if (!bounds) return false;
  return field.split(',').every((part) => is_valid_cron_part(part, bounds));
}

function is_valid_cron_part(part: string, [min, max]: [number, number]): boolean {
  const step_parts = part.split('/');
  if (step_parts.length > 2) return false;
  const [range, step] = step_parts;
  if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) return false;
  if (range === '*') return true;
  const range_parts = (range ?? '').split('-');
  if (range_parts.length > 2) return false;
  const [start, end] = range_parts;
  if (!start || !/^\d+$/.test(start)) return false;
  const start_value = Number(start);
  if (!Number.isInteger(start_value) || start_value < min || start_value > max) return false;
  if (end === undefined) return true;
  if (!/^\d+$/.test(end)) return false;
  const end_value = Number(end);
  return Number.isInteger(end_value) && end_value >= start_value && end_value <= max;
}

function describe_schedule_draft(cron: string): string | null {
  if (!is_valid_cron(cron)) return null;
  const draft = cron_to_draft(cron);
  if (!draft) return null;
  const time = format_time(String(draft.hour), String(draft.minute));

  if (draft.frequency === 'daily') return `Every day at ${time}`;
  if (draft.frequency === 'hourly') {
    return draft.minute === 0
      ? 'Every hour'
      : `Every hour at :${String(draft.minute).padStart(2, '0')}`;
  }
  if (draft.frequency === 'monthly') {
    return `Every month on day ${draft.day_of_month} at ${time}`;
  }
  if (draft.frequency === 'weekly') {
    const day_names = draft.weekdays.map(
      (weekday) => weekday_order.find((day) => day.value === weekday)?.long ?? String(weekday),
    );
    return `Every ${day_names.join(', ')} at ${time}`;
  }
  if (draft.frequency === 'interval') {
    const unit =
      draft.interval_value === 1 ? draft.interval_unit.slice(0, -1) : draft.interval_unit;
    return `Every ${draft.interval_value} ${unit}`;
  }
  return null;
}

function format_time(hour: string, minute: string) {
  return `${Number(hour)}:${minute.padStart(2, '0')}`;
}

export function read_instruction(task: Pick<Trigger, 'trigger_config'>) {
  const config = task.trigger_config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
  const job_input = (config as Record<string, unknown>).job_input;
  if (!job_input || typeof job_input !== 'object' || Array.isArray(job_input)) return '';
  const instruction = (job_input as Record<string, unknown>).instruction;
  return typeof instruction === 'string' ? instruction : '';
}
