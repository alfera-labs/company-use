export type SessionCurrentHeadlessContext = {
  reason?: string;
  local_time?: string;
};

export const wall_clock_rule = 'Use this wall-clock time for any date or time answer, not UTC.';

/**
 * What the model reads about a run nobody is present in. Such a run has no speaker, so the
 * local time is the one of the scheduled task, when the run knows its time zone.
 */
export function format_current_headless_context(headless: SessionCurrentHeadlessContext) {
  const source = headless.reason ? `autonomous run (${headless.reason})` : 'autonomous run';
  const lines = [`source: ${source}`];
  if (headless.local_time) lines.push(`local_time: ${headless.local_time}`, wall_clock_rule);
  lines.push(
    'No user is present in this run. Deliver results only where the task or your automation specifies; do not pick an audience or post to a channel on your own initiative.',
  );
  return lines.join('\n');
}
