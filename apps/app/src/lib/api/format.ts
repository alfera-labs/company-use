export function relative_time(value: string | null) {
  if (!value) return 'never';

  const diff_milliseconds = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff_milliseconds)) return 'never';

  const is_future = diff_milliseconds > 0;
  const absolute_seconds = Math.max(1, Math.round(Math.abs(diff_milliseconds) / 1000));
  if (absolute_seconds < 60) return format_relative_time(absolute_seconds, 's', is_future);

  const diff_minutes = Math.floor(absolute_seconds / 60);
  if (diff_minutes < 60) return format_relative_time(diff_minutes, 'm', is_future);

  const diff_hours = Math.floor(diff_minutes / 60);
  if (diff_hours < 24) return format_relative_time(diff_hours, 'h', is_future);

  return format_relative_time(Math.floor(diff_hours / 24), 'd', is_future);
}

function format_relative_time(value: number, unit: string, is_future: boolean) {
  return is_future ? `in ${value}${unit}` : `${value}${unit} ago`;
}
