import { AppError } from '@coworker/shared';

const window_ms = 60_000;

// Counted in this process. A self-hosted install runs one API process; with N API
// instances a caller gets N times the attempts, so move the count to the database if that changes.
const attempt_times_by_key = new Map<string, number[]>();
let last_cleanup_time = 0;

function forget_keys_without_recent_attempts(now: number): void {
  if (now - last_cleanup_time < window_ms) return;
  last_cleanup_time = now;
  for (const [key, times] of attempt_times_by_key) {
    if ((times.at(-1) ?? 0) <= now - window_ms) attempt_times_by_key.delete(key);
  }
}

export function count_attempt(key: string, attempts_per_minute: number): void {
  const now = Date.now();
  forget_keys_without_recent_attempts(now);
  const recent_times = (attempt_times_by_key.get(key) ?? []).filter(
    (time) => time > now - window_ms,
  );
  if (recent_times.length < attempts_per_minute) {
    attempt_times_by_key.set(key, [...recent_times, now]);
    return;
  }
  attempt_times_by_key.set(key, recent_times);
  const oldest_time = recent_times[0] ?? now;
  throw new AppError('rate_limited', 'Too many tries. Wait a minute, then try again.', 429, {
    retry_after_seconds: Math.ceil((oldest_time + window_ms - now) / 1000),
  });
}

export function forget_attempts(): void {
  attempt_times_by_key.clear();
}
