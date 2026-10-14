import { ConflictError, format_error_message } from '@coworker/shared';

const conflict_max_wait_ms = 30 * 60 * 1000;
const conflict_retry_base_delay_ms = 1_000;
const conflict_retry_max_delay_ms = 60_000;
const conflict_backoff_step_ms = 10_000;

const transient_provider_pattern =
  /connection error|econnreset|econnrefused|etimedout|fetch failed|socket hang up|network error|\b(502|503|504|529)\b|overloaded|rate.?limit/iu;
const transient_max_wait_ms = 12 * 60 * 1000;

export function resolve_retry_for_failed_job(
  error: unknown,
  job_created_at: Date,
  now: Date,
  first_failure_time: Date = job_created_at,
): { retry_at: Date } | undefined {
  if (is_transient_provider_error(error)) {
    const waited_ms = Math.max(now.getTime() - first_failure_time.getTime(), 0);
    if (waited_ms >= transient_max_wait_ms) return undefined;
    const delay_ms = waited_ms < 30_000 ? 30_000 : waited_ms < 150_000 ? 120_000 : 480_000;
    return { retry_at: new Date(now.getTime() + delay_ms) };
  }
  if (!(error instanceof ConflictError)) return undefined;

  const waited_ms = Math.max(now.getTime() - job_created_at.getTime(), 0);
  if (waited_ms >= conflict_max_wait_ms) return undefined;

  const delay_ms = Math.min(
    conflict_retry_base_delay_ms * 2 ** Math.floor(waited_ms / conflict_backoff_step_ms),
    conflict_retry_max_delay_ms,
  );
  return { retry_at: new Date(now.getTime() + delay_ms) };
}

export function is_transient_provider_error(error: unknown): boolean {
  const message = format_error_message(error);
  return transient_provider_pattern.test(message);
}
