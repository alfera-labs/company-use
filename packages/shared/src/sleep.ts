export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const stop_waiting = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop_waiting);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop_waiting, { once: true });
  });
}
