import { get_my_timezone, set_my_timezone } from '@/lib/api/my_timezone';

export function resolve_timezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Stores the time zone of this browser for the person, but only when the person has none. */
export async function record_browser_timezone_once() {
  const stored = await get_my_timezone();
  if (stored.timezone) return { timezone: stored.timezone };
  return set_my_timezone(resolve_timezone());
}
