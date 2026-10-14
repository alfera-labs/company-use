import { count_attempt, forget_attempts } from '@api/lib/attempt_limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const just_before_a_minute_ends = new Date('2026-10-14T18:01:59.900Z');

function try_once(key: string): unknown {
  try {
    count_attempt(key, 10);
    return 'allowed';
  } catch (error) {
    return error;
  }
}

function try_ten_times(key: string): void {
  for (let attempt = 0; attempt < 10; attempt += 1) expect(try_once(key)).toBe('allowed');
}

describe('the attempt limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(just_before_a_minute_ends);
    forget_attempts();
  });
  afterEach(() => vi.useRealTimers());

  it('refuses the eleventh try in sixty seconds, also across a minute boundary', () => {
    try_ten_times('one');
    vi.advanceTimersByTime(200);
    expect(try_once('one')).toMatchObject({ code: 'rate_limited' });
    expect(try_once('other')).toBe('allowed');
  });

  it('allows new tries once the earlier tries are sixty seconds old, and says when', () => {
    try_ten_times('one');
    vi.advanceTimersByTime(59_000);
    expect(try_once('one')).toMatchObject({ details: { retry_after_seconds: 1 } });
    vi.advanceTimersByTime(1_000);
    try_ten_times('one');
    expect(try_once('one')).toMatchObject({ code: 'rate_limited' });
  });
});
