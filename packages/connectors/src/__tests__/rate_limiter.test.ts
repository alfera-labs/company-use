import {
  pause_rate_limit_bucket,
  reset_rate_limit_buckets,
  run_under_rate_limit,
} from '@connectors/runtime/rate_limiter';
import type { ConnectorRateLimits } from '@connectors/types';
import { beforeEach, describe, expect, it } from 'vitest';

const limits: ConnectorRateLimits = { rpm: 600, concurrency: 4, burst: 1 };

function wait_ms(delay_ms: number) {
  return new Promise((resolve) => setTimeout(resolve, delay_ms));
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

describe('run_under_rate_limit', () => {
  it('spaces calls past the burst at the app rpm', async () => {
    const key = { app_key: 'example', connection_id: 'conn_spacing' };
    const started_ms = Date.now();

    await Promise.all([
      run_under_rate_limit(key, limits, async () => 'a'),
      run_under_rate_limit(key, limits, async () => 'b'),
      run_under_rate_limit(key, limits, async () => 'c'),
    ]);

    expect(Date.now() - started_ms).toBeGreaterThanOrEqual(180);
  });

  it('keeps separate buckets per connection', async () => {
    const started_ms = Date.now();

    await Promise.all([
      run_under_rate_limit(
        { app_key: 'example', connection_id: 'conn_a' },
        limits,
        async () => 'a',
      ),
      run_under_rate_limit(
        { app_key: 'example', connection_id: 'conn_b' },
        limits,
        async () => 'b',
      ),
      run_under_rate_limit(
        { app_key: 'example', connection_id: 'conn_c' },
        limits,
        async () => 'c',
      ),
    ]);

    expect(Date.now() - started_ms).toBeLessThan(80);
  });

  it('never runs more work at once than the app concurrency allows', async () => {
    const key = { app_key: 'example', connection_id: 'conn_concurrency' };
    const concurrency_limits: ConnectorRateLimits = { rpm: 60_000, concurrency: 2, burst: 100 };
    let running = 0;
    let highest_running = 0;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        run_under_rate_limit(key, concurrency_limits, async () => {
          running += 1;
          highest_running = Math.max(highest_running, running);
          await wait_ms(20);
          running -= 1;
        }),
      ),
    );

    expect(highest_running).toBe(2);
    expect(running).toBe(0);
  });

  it('holds the whole bucket for the length of a Retry-After pause', async () => {
    const key = { app_key: 'example', connection_id: 'conn_paused' };
    const fast_limits: ConnectorRateLimits = { rpm: 60_000, concurrency: 4, burst: 100 };
    pause_rate_limit_bucket(key, fast_limits, 150);
    const started_ms = Date.now();

    await run_under_rate_limit(key, fast_limits, async () => 'a');

    expect(Date.now() - started_ms).toBeGreaterThanOrEqual(140);
  });

  it('releases its slot when the work throws', async () => {
    const key = { app_key: 'example', connection_id: 'conn_failure' };
    const one_at_a_time: ConnectorRateLimits = { rpm: 60_000, concurrency: 1, burst: 100 };

    await expect(
      run_under_rate_limit(key, one_at_a_time, async () => {
        throw new Error('provider exploded');
      }),
    ).rejects.toThrow('provider exploded');

    await expect(run_under_rate_limit(key, one_at_a_time, async () => 'ok')).resolves.toBe('ok');
  });
});
