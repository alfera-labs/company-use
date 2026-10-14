import { createHash } from 'node:crypto';

const jitter_window_minutes = {
  full_hour: 60,
  small_window: 5,
} as const;

export type ScheduleJitterWindow = keyof typeof jitter_window_minutes;

export function add_schedule_jitter(input: {
  cron_expression: string;
  workspace_id: string;
  window: ScheduleJitterWindow;
}): string {
  const fields = input.cron_expression.trim().split(/\s+/);
  const [minute_field, hour_field = '', ...rest] = fields;
  const minute = fields.length === 5 ? read_plain_minute(minute_field) : null;
  if (minute === null) return input.cron_expression;

  const offset = workspace_minute_hash(input.workspace_id) % jitter_window_minutes[input.window];
  const jittered = input.window === 'full_hour' ? offset : minute + offset;
  if (jittered < 60) return [jittered, hour_field, ...rest].join(' ');

  const carried_hour = carry_hour(hour_field);
  if (carried_hour === null) return input.cron_expression;
  return [jittered - 60, carried_hour, ...rest].join(' ');
}

function read_plain_minute(field: string | undefined): number | null {
  if (field === undefined || !/^\d{1,2}$/.test(field)) return null;
  const minute = Number(field);
  return minute <= 59 ? minute : null;
}

function carry_hour(hour_field: string): string | null {
  if (hour_field === '*') return '*';
  const hour = /^\d{1,2}$/.test(hour_field) ? Number(hour_field) : null;
  return hour !== null && hour < 23 ? String(hour + 1) : null;
}

function workspace_minute_hash(workspace_id: string): number {
  const digest = createHash('md5').update(workspace_id, 'utf8').digest('hex');
  return Number.parseInt(digest.slice(0, 6), 16);
}
