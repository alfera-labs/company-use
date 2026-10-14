import { fan_out } from '@connectors/runtime/fan_out';
import { ConnectorHttpError } from '@connectors/runtime/http_request';
import type { ConnectorRateLimits } from '@connectors/types';
import { describe, expect, it } from 'vitest';

const limits: ConnectorRateLimits = { rpm: 60_000, concurrency: 3, burst: 100 };

function wait_ms(delay_ms: number) {
  return new Promise((resolve) => setTimeout(resolve, delay_ms));
}

describe('fan_out', () => {
  it('returns results in the caller order, not the completion order', async () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];

    const results = await fan_out({
      items,
      limits,
      call_one: async (item, index) => {
        await wait_ms((items.length - index) * 5);
        return item.toUpperCase();
      },
    });

    expect(results.map((result) => (result.ok ? result.data : null))).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
    ]);
    expect(results.map((result) => result.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('captures one item failure and still returns every other result', async () => {
    const results = await fan_out({
      items: ['a', 'b', 'c'],
      limits,
      call_one: async (item) => {
        if (item === 'b') throw new ConnectorHttpError('rate_limited', 'slow down', 429, true);
        return item.toUpperCase();
      },
    });

    expect(results[0]).toEqual({ ok: true, index: 0, data: 'A' });
    expect(results[1]).toEqual({
      ok: false,
      index: 1,
      error: { code: 'rate_limited', message: 'slow down', retryable: true },
    });
    expect(results[2]).toEqual({ ok: true, index: 2, data: 'C' });
  });

  it('turns a plain error into a non-retryable node failure', async () => {
    const results = await fan_out({
      items: ['a'],
      limits,
      call_one: async () => {
        throw new Error('the node blew up');
      },
    });

    expect(results[0]).toEqual({
      ok: false,
      index: 0,
      error: { code: 'node_failed', message: 'the node blew up', retryable: false },
    });
  });

  it('rejects on the first failure when the node is atomic', async () => {
    await expect(
      fan_out({
        items: ['a', 'b', 'c'],
        limits,
        atomic: true,
        call_one: async (item) => {
          if (item === 'b') throw new Error('half a write is worse than none');
          return item;
        },
      }),
    ).rejects.toThrow('half a write is worse than none');
  });

  it('never runs more items at once than the app concurrency allows', async () => {
    let running = 0;
    let highest_running = 0;

    await fan_out({
      items: Array.from({ length: 12 }, (_, index) => index),
      limits,
      call_one: async (item) => {
        running += 1;
        highest_running = Math.max(highest_running, running);
        await wait_ms(10);
        running -= 1;
        return item;
      },
    });

    expect(highest_running).toBe(limits.concurrency);
  });

  it('returns nothing for an empty batch', async () => {
    const results = await fan_out({ items: [], limits, call_one: async () => 'never' });
    expect(results).toEqual([]);
  });
});
