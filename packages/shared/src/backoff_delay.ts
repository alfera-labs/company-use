export type BackoffOptions = {
  readonly base_ms: number;
  readonly max_ms?: number;
  readonly jitter_ratio?: number;
};

export function calculate_backoff_delay(attempt: number, options: BackoffOptions): number {
  const ceiling = Math.min(
    options.base_ms * 2 ** Math.max(0, attempt - 1),
    options.max_ms ?? Infinity,
  );
  const jitter_ratio = options.jitter_ratio ?? 0;
  if (jitter_ratio === 0) return ceiling;
  return ceiling * (1 - jitter_ratio) + Math.random() * ceiling * jitter_ratio;
}
