/** Thrown when work runs past its deadline. The work's signal is aborted at the same moment. */
export class PolicyTimeoutError extends Error {
  constructor(public readonly timeout_ms: number) {
    super(`Policy timeout after ${timeout_ms}ms`);
  }
}

/** Runs work with a deadline. A non-finite or non-positive deadline means no deadline. */
export async function run_with_timeout<T>(
  timeout_ms: number,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const gave_up = new AbortController();
  const promise = run(signal ? AbortSignal.any([signal, gave_up.signal]) : gave_up.signal);
  if (!Number.isFinite(timeout_ms) || timeout_ms <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timed_out = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new PolicyTimeoutError(timeout_ms));
      gave_up.abort();
    }, timeout_ms);
  });
  return await Promise.race([promise, timed_out]).finally(() => clearTimeout(timer));
}
