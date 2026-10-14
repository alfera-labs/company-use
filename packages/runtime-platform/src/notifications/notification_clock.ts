import type { NotificationRules } from '@runtime-platform/notifications/notification_rules_file';
import { notification_rules_timezone } from '@runtime-platform/notifications/notification_rules_schema';

export function is_inside_quiet_hours(now: Date, policy: NotificationRules) {
  const quiet = policy.quiet_hours;
  if (!quiet) return false;
  const minutes = local_minutes_of_day(now, quiet.timezone);
  const start = clock_minutes(quiet.start);
  const end = clock_minutes(quiet.end);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function next_daily_summary_time(now: Date, policy: NotificationRules) {
  const timezone = notification_rules_timezone(policy);
  const minutes_until =
    (clock_minutes(policy.daily_summary_at_time) - local_minutes_of_day(now, timezone) + 1_440) %
      1_440 || 1_440;
  // Minutes of wall clock, so a DST change can shift this by an hour. A notification that
  // hinges on that hour is a deadline, and a deadline already crosses quiet hours.
  return new Date(now.getTime() + minutes_until * 60_000);
}

export function local_minutes_of_day(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return (hour % 24) * 60 + minute;
}

function clock_minutes(clock_time: string) {
  const [hours = '0', minutes = '0'] = clock_time.split(':');
  return Number(hours) * 60 + Number(minutes);
}
