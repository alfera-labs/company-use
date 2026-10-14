import { calculate_backoff_delay } from '@shared/backoff_delay';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('calculate_backoff_delay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('doubles the base delay on each attempt', () => {
    const delays = [1, 2, 3, 4].map((attempt) =>
      calculate_backoff_delay(attempt, { base_ms: 500 }),
    );
    expect(delays).toEqual([500, 1_000, 2_000, 4_000]);
  });

  it('treats an attempt below one as the first attempt', () => {
    expect(calculate_backoff_delay(0, { base_ms: 1_000 })).toBe(1_000);
  });

  it('stops at the maximum delay', () => {
    expect(calculate_backoff_delay(10, { base_ms: 2_000, max_ms: 300_000 })).toBe(300_000);
  });

  it('keeps the fixed part and randomizes the jitter part', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(calculate_backoff_delay(2, { base_ms: 1_000, jitter_ratio: 0.5 })).toBe(1_500);
  });
});
