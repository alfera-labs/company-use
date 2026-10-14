const milliseconds_per_day = 86_400_000;

export function day_separator_label(sent_time: string, now: number | Date = Date.now()) {
  const sent = new Date(sent_time);
  const today = new Date(now);
  const days_apart = Math.round(
    (local_midnight(today) - local_midnight(sent)) / milliseconds_per_day,
  );
  if (days_apart === 0) return 'Today';
  if (days_apart === 1) return 'Yesterday';

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sent.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  }).format(sent);
}

export function is_new_day(previous_time: string | undefined, next_time: string | undefined) {
  const next_day = local_day_key(next_time);
  if (!next_day) return false;
  const previous_day = local_day_key(previous_time);
  return previous_day !== next_day;
}

export function clock_time_label(sent_time: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(sent_time),
  );
}

function local_day_key(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function local_midnight(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}
