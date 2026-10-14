import { env } from '@coworker/config';
import { trigger_rule_schema } from '@coworker/core/access/trigger_rules';
import { delivery_channels } from '@coworker/core/db/schema/automation_contracts';
import type { TriggerRule } from '@coworker/core/db/schema/json_column_types';
import { default_delivery_channel_order } from '@runtime-platform/notifications/default_delivery_channel_order';
import { z } from 'zod';

export const dial_levels = ['off', 'quiet', 'normal', 'eager'] as const;
export const daily_summary_cadences = ['daily', 'weekdays'] as const;
export const notifications_per_day_hard_ceiling = 15;
const default_quiet_start = '19:00';
const default_quiet_end = '08:00';
export const default_timezone = 'UTC';
export const per_automation_notifications_hard_ceiling = 30;
const triage_calls_ceiling = 1_000;
const default_triage_calls_per_day = 300;

const clock_time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Use a 24-hour HH:MM time, for example 19:00.');

export function is_real_timezone(timezone: string) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const timezone_name = z
  .string()
  .min(1)
  .refine(is_real_timezone, 'Use an IANA timezone name, for example Europe/London.');

const quiet_hours_object = z.strictObject({
  start: clock_time,
  end: clock_time,
  timezone: timezone_name.default(default_timezone),
});

const no_quiet_hours_words = new Set(['', 'none', 'null', 'off', 'empty', 'no', 'never']);

const quiet_hours_line = z
  .string()
  .trim()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d\s*-\s*([01]\d|2[0-3]):[0-5]\d(\s+\S+)?$/u,
    'Write quiet hours as 19:00-08:00 Europe/London.',
  )
  .transform((line) => {
    const [window = '', timezone = 'UTC'] = line.split(/\s+/u);
    const [start = '', end = ''] = window.split('-');
    return { start, end, timezone };
  })
  .refine(
    (quiet) => is_real_timezone(quiet.timezone),
    'Use an IANA timezone name, for example Europe/London.',
  );

// A junk rule as a person writes it on one line: the field, the operation, then the values.
// `sender address_is_not_any_of me@example.com you@example.com`.
// Values are split on spaces, so a value containing a space cannot be written here —
// give the list a block form if one ever needs to be.
function read_rule_line(line: string): Record<string, unknown> {
  const [field = '', operation = '', ...values] = line.trim().split(/\s+/u);
  return { field, operation, values };
}

export function render_rule_line(rule: TriggerRule): string {
  return [rule.field, rule.operation, ...(rule.values ?? [])].join(' ');
}

const ignore_rule_schema = z.union([
  trigger_rule_schema,
  z.string().trim().min(1).transform(read_rule_line).pipe(trigger_rule_schema),
]);

export const notification_rules_fields = z.strictObject({
  dial: z.enum(dial_levels).default('normal'),
  timezone: timezone_name.optional(),
  quiet_hours: z
    .preprocess(
      (value) =>
        typeof value === 'string' && no_quiet_hours_words.has(value.trim().toLowerCase())
          ? null
          : value,
      z.union([quiet_hours_object, quiet_hours_line]).nullable(),
    )
    .default({ start: default_quiet_start, end: default_quiet_end, timezone: default_timezone }),
  max_notifications_per_day: z.coerce
    .number()
    .int()
    .min(0)
    .transform((cap) => Math.min(cap, notifications_per_day_hard_ceiling))
    .default(5),
  daily_summary_cadence: z.enum(daily_summary_cadences).default('weekdays'),
  daily_summary_at_time: clock_time.default('08:30'),
  daily_summary_channel: z
    .enum(delivery_channels)
    .default(() => default_delivery_channel_order(env)[0] ?? 'web'),
  delivery_channel_order: z
    .array(z.enum(delivery_channels))
    .min(1)
    .default(() => default_delivery_channel_order(env)),
  always_notify: z.array(z.string().trim().min(1)).default([]),
  never_notify: z.array(z.string().trim().min(1)).default([]),
  own_daily_limit: z
    .record(
      z.string().min(1),
      z.coerce
        .number()
        .int()
        .min(0)
        .transform((cap) => Math.min(cap, per_automation_notifications_hard_ceiling)),
    )
    .default({}),
  ignore: z.array(ignore_rule_schema).default([]),
  triage_calls_per_day: z.coerce
    .number()
    .int()
    .min(0)
    .transform((calls) => Math.min(calls, triage_calls_ceiling))
    .default(default_triage_calls_per_day),
});

function unfold_written_keys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const written = { ...(value as Record<string, unknown>) };
  if (written.dial === undefined && written.mode !== undefined) written.dial = written.mode;
  delete written.mode;
  if (written.daily_summary !== undefined) {
    Object.assign(written, read_daily_summary_line(written.daily_summary));
    delete written.daily_summary;
  }
  if (written.automation_overrides !== undefined) {
    Object.assign(written, read_automation_overrides(written));
    delete written.automation_overrides;
  }
  return written;
}

function read_daily_summary_line(daily_summary: unknown) {
  if (typeof daily_summary !== 'string') return { daily_summary_at_time: daily_summary };
  const match = /^(\w+)\s+(\S+)(?:\s*->\s*(\S+))?$/u.exec(daily_summary.trim());
  if (!match) return { daily_summary_at_time: daily_summary };
  return {
    daily_summary_cadence: match[1],
    daily_summary_at_time: match[2],
    ...(match[3] ? { daily_summary_channel: match[3] } : {}),
  };
}

function read_automation_overrides(written: Record<string, unknown>) {
  const overrides = written.automation_overrides;
  if (!overrides || typeof overrides !== 'object') return {};
  const always = [...as_list(written.always_notify)];
  const never = [...as_list(written.never_notify)];
  for (const [automation, rule] of Object.entries(overrides as Record<string, unknown>)) {
    if (rule === 'always_notify' && !always.includes(automation)) always.push(automation);
    if (rule === 'never_notify' && !never.includes(automation)) never.push(automation);
  }
  return { always_notify: always, never_notify: never };
}

function as_list(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

export const notification_rules_schema = z.preprocess(
  unfold_written_keys,
  notification_rules_fields,
);

export type NotificationRules = z.output<typeof notification_rules_schema>;

type NotificationRulesWritten = z.input<typeof notification_rules_fields>;
export type NotificationRulesChanges = {
  [K in keyof NotificationRulesWritten]?: NotificationRulesWritten[K] | undefined;
};

export const default_notification_rules: NotificationRules = notification_rules_schema.parse({});

export function notification_rules_timezone(policy: {
  timezone?: string | undefined;
  quiet_hours?: { timezone: string } | null | undefined;
}): string {
  return policy.timezone ?? policy.quiet_hours?.timezone ?? default_timezone;
}
