import { resolve_mentions } from '@runtime-platform/channels/slack/directory';
import type { SlackHistoryMessage } from '@runtime-platform/channels/slack/history';

/**
 * A file upload arrives as subtype 'file_share'. It is still a person posting, and the weekly
 * report somebody uploads every Monday is exactly the recurring work the sweep looks for.
 */
export function is_written_by_a_person(message: SlackHistoryMessage) {
  return message.subtype === null || message.subtype === 'file_share';
}

/** The day leads the line, so a job that comes back every Monday reads as one. */
export function digest_sample_line(message: SlackHistoryMessage, name_by_id: Map<string, string>) {
  const speaker = message.user_id
    ? `@${name_by_id.get(message.user_id) ?? message.user_id}`
    : '@unknown';
  const text = resolve_mentions(message.text.replace(/\r?\n/g, ' '), name_by_id);
  const files = message.file_names.map((file_name) => `[file: ${file_name}]`).join(' ');
  return [weekday_and_iso_date(message.message_ts), `${speaker}:`, text, files]
    .filter(Boolean)
    .join(' ');
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekday_and_iso_date(message_ts: string) {
  const seconds = Number.parseFloat(message_ts);
  if (!Number.isFinite(seconds)) return '';
  const day = new Date(seconds * 1000);
  return `${weekdays[day.getUTCDay()]} ${day.toISOString().slice(0, 10)}`;
}
