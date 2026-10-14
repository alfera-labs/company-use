/** Names a queue in logs as `queue_key (workspace_id)`. */
export function queue_label(queue_key: string, workspace_id: string) {
  return `${queue_key} (${workspace_id})`;
}

/** Writes a count with its noun, plural when the count is not one. */
export function count_label(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Writes milliseconds as `850ms` or `1.5s`. */
export function format_duration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

/** Says in plain words when a queued job starts. */
export function when_it_runs(delay_ms: number, deferred_to_recovery: boolean) {
  if (deferred_to_recovery) return `ready in ${format_duration(delay_ms)}, recovery will run it`;
  if (delay_ms <= 0) return 'starting now';
  return `starting in ${format_duration(delay_ms)}`;
}
