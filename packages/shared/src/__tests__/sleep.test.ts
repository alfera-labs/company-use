import { sleep } from '@shared/sleep';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    let done = false;
    const waiting = sleep(1_000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });

  it('resolves at once when the signal aborts', async () => {
    const controller = new AbortController();
    const waiting = sleep(60_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBeUndefined();
  });

  it('resolves at once when the signal is already aborted', async () => {
    await expect(sleep(60_000, AbortSignal.abort())).resolves.toBeUndefined();
  });
});
