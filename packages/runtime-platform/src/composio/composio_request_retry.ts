import { calculate_backoff_delay } from '@coworker/shared';

export const composio_retry_maximum_attempts = 5;
const retry_base_delay_ms = 500;
const retry_maximum_delay_ms = 20_000;

/**
 * A 429 means Composio refused and did no work, so it is always repeated. A 5xx or no answer
 * leaves the outcome unknown, so it is repeated only when repeating is harmless.
 */
export function may_repeat_failed_request(input: {
  status: number | null;
  signal: AbortSignal | undefined;
  repeat_when_unsure: boolean;
}) {
  if (input.signal?.aborted) return false;
  if (input.status === 429) return true;
  return input.repeat_when_unsure && (input.status === null || input.status >= 500);
}

/** GET and HEAD read without changing anything, so repeating them after a 5xx is harmless. */
export function repeats_are_safe_for_http_method(method: string) {
  return method === 'GET' || method === 'HEAD';
}

/** Waits what Composio asked for in Retry-After, or backs off with jitter. */
export function calculate_retry_delay_ms(attempt: number, retry_after_ms: number | null) {
  if (retry_after_ms !== null) return Math.min(retry_after_ms, retry_maximum_delay_ms);
  return calculate_backoff_delay(attempt, {
    base_ms: retry_base_delay_ms,
    max_ms: retry_maximum_delay_ms,
    jitter_ratio: 0.5,
  });
}
