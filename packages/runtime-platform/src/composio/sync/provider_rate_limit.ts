const rate_limit_text = /rate[ _-]?limit|too many requests|quota exceeded/i;
const too_many_requests_status = /\b429\b/;
const retry_after_text = /retry[ _-]after["':=\s]*(\d+)/i;
const reset_epoch_text = /x-ratelimit-reset["':=\s]*(\d{10})\b/i;

export type ProviderRateLimit = { retry_after_seconds: number | null };

export function message_names_rate_limit(message: string): boolean {
  return rate_limit_text.test(message) || too_many_requests_status.test(message);
}

function read_retry_after_seconds(message: string, now: Date): number | null {
  const retry_after = retry_after_text.exec(message)?.[1];
  if (retry_after) return Number(retry_after);
  const reset_epoch = reset_epoch_text.exec(message)?.[1];
  if (!reset_epoch) return null;
  return Math.max(Number(reset_epoch) - Math.floor(now.getTime() / 1000), 0);
}

/** Finds a provider rate limit in a failed call: a 429, a rate_limited code, or a 403 that says so. */
export function find_provider_rate_limit(input: {
  error_code: string;
  message: string;
  status: number | null;
  retry_after_seconds: number | null;
  now: Date;
}): ProviderRateLimit | null {
  const limited =
    input.error_code === 'rate_limited' ||
    input.status === 429 ||
    message_names_rate_limit(input.message);
  if (!limited) return null;
  return {
    retry_after_seconds:
      input.retry_after_seconds ?? read_retry_after_seconds(input.message, input.now),
  };
}
