import type { TriggerSchedule } from '@coworker/runtime-platform';

// Pure translation from our schedule shape to an AWS EventBridge Scheduler ScheduleExpression.
// EventBridge uses a 6-field cron that differs from standard 5-field Unix cron in three ways, all
// handled here:
//   1. Six fields: cron(minutes hours day-of-month month day-of-week year).
//   2. Day-of-week is 1–7 with 1 = Sunday (Unix is 0–6 with 0 = Sunday). We remap.
//   3. You may NOT use '*' in both day-of-month and day-of-week — exactly one must be '?'.
// One-time tasks become at(yyyy-mm-ddThh:mm:ss); recurring tasks become cron(...).
//
// Throws on input the translator can't faithfully represent, so a bad schedule fails loudly at
// provisioning rather than silently creating the wrong AWS schedule.

export type AwsScheduleExpression = {
  expression: string;
  timezone?: string;
};

export function to_aws_schedule_expression(schedule: TriggerSchedule): AwsScheduleExpression {
  if (schedule.run_once_at) return to_one_time_expression(schedule.run_once_at);
  return to_recurring_expression(schedule.cron_expression, schedule.timezone);
}

function to_one_time_expression(run_once_at: string): AwsScheduleExpression {
  const at = utc_wall_clock(run_once_at);
  if (!at) throw new Error(`Invalid one-time timestamp: ${run_once_at}`);
  return { expression: `at(${at})` };
}

function to_recurring_expression(
  cron_expression: string,
  timezone: string | undefined,
): AwsScheduleExpression {
  const fields = cron_expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Expected a 5-field cron, got: ${cron_expression}`);
  }
  const [minute = '', hour = '', day_of_month = '', month = '', day_of_week = ''] = fields;
  const { dom, dow } = to_aws_day_fields(day_of_month, day_of_week);
  return {
    expression: `cron(${minute} ${hour} ${dom} ${month} ${dow} *)`,
    ...(timezone ? { timezone } : {}),
  };
}

function to_aws_day_fields(unix_dom: string, unix_dow: string): { dom: string; dow: string } {
  const dom_wild = unix_dom === '*';
  const dow_wild = unix_dow === '*';

  if (dow_wild && !dom_wild) return { dom: unix_dom, dow: '?' };
  if (!dow_wild && dom_wild) return { dom: '?', dow: remap_unix_dow(unix_dow) };
  if (dom_wild && dow_wild) return { dom: '*', dow: '?' };
  throw new Error(
    `AWS cron cannot constrain both day-of-month and day-of-week: ${unix_dom} ${unix_dow}`,
  );
}

function remap_unix_dow(field: string): string {
  return field
    .split(',')
    .map((part) => part.split('-').map(remap_unix_dow_value).join('-'))
    .join(',');
}

function remap_unix_dow_value(value: string): string {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 7) {
    throw new Error(`Invalid day-of-week value: ${value}`);
  }
  return String((n % 7) + 1);
}

function utc_wall_clock(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '');
}
