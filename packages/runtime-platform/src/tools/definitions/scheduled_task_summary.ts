import { find_next_run_time } from '@runtime-platform/events/next_schedule_run_time';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { z } from 'zod';

export const scheduled_task_summary_schema = z.strictObject({
  scheduled_task_id: z.string(),
  name: z.string(),
  status: z.string(),
  cron_expression: z.string().nullable(),
  instruction: z.string().nullable(),
  context_digest: z.string().nullable(),
  timezone: z.string().nullable(),
  run_once_at: z.string().nullable(),
  next_run_time: z
    .string()
    .nullable()
    .describe(
      'When the task runs next, as an ISO timestamp. It is worked out when this tool answers, so it is final. Null only when the task has no next run.',
    ),
  next_run_in_task_timezone: z
    .string()
    .describe(
      'The same time as a person reads it, in the time zone of the task, with the zone in brackets. When there is no next run, it says why.',
    ),
  last_run_time: z.string().nullable(),
});

const scheduled_task_trigger_config_schema = z
  .object({
    timezone: z.string().optional(),
    run_once_at: z.string().optional(),
    job_input: z
      .object({
        instruction: z.string().optional(),
        context_digest: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * What a schedule tool says of one task. The next run is worked out when the tool answers, so
 * the model never has to guess it or wait for the scheduler to store it: `next_run_time` is the
 * instant, and `next_run_in_task_timezone` is the same instant as a person reads it, such as
 * "Tuesday 13 October 2026 at 09:00 (Europe/Rome)", or the reason there is no next run. A task
 * with no time zone of its own runs in the time zone of the machine, as the scheduler reads it.
 */
export function summarize_scheduled_task(trigger: TriggerRow) {
  const config = scheduled_task_trigger_config_schema.parse(trigger.trigger_config);

  return scheduled_task_summary_schema.parse({
    scheduled_task_id: trigger.trigger_id,
    name: trigger.trigger_name,
    status: trigger.trigger_status,
    cron_expression: trigger.schedule_expression ?? null,
    instruction: config.job_input?.instruction ?? null,
    context_digest: config.job_input?.context_digest ?? null,
    timezone: config.timezone ?? null,
    run_once_at: config.run_once_at ?? null,
    ...describe_next_run(trigger),
    last_run_time: trigger.last_run_time?.toISOString() ?? null,
  });
}

const words_for_no_next_run: Record<string, string> = {
  disabled: 'none while the task is paused',
  completed: 'none: this one-time task has run',
  error: 'none while the task is in an error state',
};

function describe_next_run(trigger: TriggerRow, now: Date = new Date()) {
  const next_run = find_next_run_time(trigger, now);
  if (!next_run) {
    return {
      next_run_time: null,
      next_run_in_task_timezone:
        words_for_no_next_run[trigger.trigger_status] ??
        'unknown: the schedule of the task could not be read',
    };
  }

  const local_time = format_as_weekday_date_and_time(
    next_run,
    read_timezone_the_scheduler_uses(trigger),
  );
  return {
    next_run_time: next_run.toISOString(),
    next_run_in_task_timezone:
      next_run <= now ? `now: it was due on ${local_time}, so it runs within a minute` : local_time,
  };
}

function read_timezone_the_scheduler_uses(trigger: TriggerRow): string {
  return trigger.trigger_config?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function format_as_weekday_date_and_time(instant: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((candidate) => candidate.type === type)?.value ?? '';
    return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')} at ${part('hour')}:${part('minute')} (${timezone})`;
  } catch {
    return `${instant.toISOString()} (UTC)`;
  }
}
