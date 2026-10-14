import {
  read_trigger_schedule,
  type TriggerRow,
  type TriggerSchedule,
} from '@runtime-platform/events/trigger_ingress';
import { Cron } from 'croner';

/**
 * The next time a recurring schedule runs after a moment, in the time zone of the schedule.
 * Null for a one-time schedule, and for an expression that cannot be read.
 */
export function next_cron_run_time(schedule: TriggerSchedule, after: Date): Date | null {
  if (schedule.run_once_at) return null;
  try {
    return new Cron(schedule.cron_expression, {
      ...(schedule.timezone ? { timezone: schedule.timezone } : {}),
    }).nextRun(after);
  } catch {
    return null;
  }
}

/**
 * When an enabled schedule trigger runs next, by the rule the scheduler follows: a one-time
 * task at its own time, a recurring one at the time the scheduler stored for it, and at the
 * next time of its expression while none is stored yet. A time that has passed means the
 * scheduler runs the task the next time it looks. Null for a trigger that is not enabled or
 * has no schedule. The task card shows the stored time, so a tool that says this time and the
 * card never disagree.
 */
export function find_next_run_time(trigger: TriggerRow, now: Date): Date | null {
  if (trigger.trigger_status !== 'enabled') return null;
  const schedule = read_trigger_schedule(trigger);
  if (!schedule) return null;
  const stored = schedule.run_once_at ? new Date(schedule.run_once_at) : trigger.next_run_time;
  if (!stored || Number.isNaN(stored.getTime())) return next_cron_run_time(schedule, now);
  return stored;
}
