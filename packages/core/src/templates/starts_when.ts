import type { StartsWhenEntry } from '@coworker/core/templates/template_object';

const day_names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const day_aliases: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

/** Which icon a start condition prints. The calendar covers all three: they are all timings. */
export function start_mode_icon(start: StartsWhenEntry): 'calendar' | 'bolt' | 'chat' {
  if (start.start_mode === 'you_ask') return 'chat';
  if (start.start_mode === 'something_happens') return 'bolt';
  return 'calendar';
}

/** The heading of one block under "When it runs". */
export function describe_start_title(start: StartsWhenEntry): string {
  if (start.label) return capitalize(start.label);
  if (start.start_mode === 'you_ask') return 'When you ask';
  if (start.start_mode === 'something_happens') {
    return start.listens_to ? `When ${humanize_key(start.listens_to.node_key)}` : 'When it happens';
  }
  return capitalize(describe_schedule(start));
}

/**
 * The same start, folded into a row that has one line for all of them. Lower case throughout, and
 * "on request" rather than "when you ask", because the tokens join: "On request or every Monday".
 */
export function describe_start_token(start: StartsWhenEntry): string {
  if (start.start_mode === 'you_ask') return 'on request';
  if (start.label) return lowercase_first(start.label);
  if (start.start_mode === 'something_happens') {
    return start.listens_to ? `when ${humanize_key(start.listens_to.node_key)}` : 'when it happens';
  }
  return describe_schedule(start);
}

/** Every start condition as one line: "On request or every Monday". */
export function describe_when_line(starts_when: StartsWhenEntry[]): string {
  if (starts_when.length === 0) return '';
  return capitalize(starts_when.map(describe_start_token).join(' or '));
}

/**
 * "every Monday", or "every Monday at 08:00" when the author fixed the time.
 *
 * A schedule whose timezone the installer chooses has no time to print yet: the installer picks
 * one during setup, so printing the author's 08:00 would be a number nobody agreed to.
 */
export function describe_schedule(start: StartsWhenEntry): string {
  const cron = start.schedule_expression;
  if (!cron) return 'on a schedule';
  const parts = read_cron(cron);
  if (!parts) return cron;
  const asks_the_installer = start.read_timezone_from === 'ask_the_installer';
  return asks_the_installer ? parts.cadence : `${parts.cadence} at ${parts.time}`;
}

type CronParts = { cadence: string; time: string };

function read_cron(expression: string): CronParts | null {
  const [minute, hour, day_of_month, month, day_of_week] = expression.trim().split(/\s+/u);
  const time = clock_time(minute, hour);
  if (time === null) return null;

  if (day_of_week && day_of_week !== '*') {
    const day = read_day(day_of_week);
    return day === null ? null : { cadence: `every ${day}`, time };
  }
  if (day_of_month && day_of_month !== '*') {
    const day = Number(day_of_month);
    if (!Number.isInteger(day)) return null;
    const every = month && month !== '*' ? 'each year on the' : 'on the';
    return { cadence: `${every} ${ordinal(day)} of the month`, time };
  }
  return { cadence: 'every day', time };
}

function clock_time(minute: string | undefined, hour: string | undefined) {
  const minute_value = Number(minute);
  const hour_value = Number(hour);
  if (!Number.isInteger(minute_value) || !Number.isInteger(hour_value)) return null;
  return `${String(hour_value).padStart(2, '0')}:${String(minute_value).padStart(2, '0')}`;
}

function read_day(day_of_week: string) {
  const alias = day_aliases[day_of_week.toUpperCase()];
  if (alias !== undefined) return day_names[alias] ?? null;
  const numeric = Number(day_of_week);
  if (!Number.isInteger(numeric)) return null;
  return day_names[numeric % 7] ?? null;
}

/** "Your Monday time and timezone" — the install question a scheduled start adds. */
export function describe_timezone_question(starts_when: StartsWhenEntry[]): string {
  const scheduled = starts_when.find(
    (start) => start.start_mode === 'on_a_schedule' && start.schedule_expression,
  );
  const parts = scheduled?.schedule_expression ? read_cron(scheduled.schedule_expression) : null;
  const cadence = parts?.cadence.replace(/^every /u, '').replace(/^day$/u, 'daily') ?? 'run';
  return `Your ${cadence} time and timezone`;
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th';
  return `${value}${suffix}`;
}

function humanize_key(node_key: string) {
  return node_key.replace(/[-_]/gu, ' ').trim();
}

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowercase_first(text: string) {
  const [first = '', ...rest] = text.split(' ');
  const is_acronym = first.length > 1 && first.slice(1) !== first.slice(1).toLowerCase();
  const is_day = day_names.includes(first.replace(/[^A-Za-z]/gu, ''));
  if (is_acronym || is_day) return text;
  return [first.toLowerCase(), ...rest].join(' ');
}
