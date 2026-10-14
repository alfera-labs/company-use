import { run_tasks_with_concurrency } from '@coworker/evals/bounded_task_runner';
import { describe, expect, it } from 'vitest';

describe('run_tasks_with_concurrency', () => {
  it('never exceeds the requested task count', async () => {
    let active_count = 0;
    let maximum_active_count = 0;
    await run_tasks_with_concurrency(
      Array.from({ length: 12 }, (_, index) => index),
      5,
      async () => {
        active_count += 1;
        maximum_active_count = Math.max(maximum_active_count, active_count);
        await sleep(5);
        active_count -= 1;
      },
    );

    expect(maximum_active_count).toBe(5);
  });

  it('stops admitting tasks after a failure and waits for admitted tasks to settle', async () => {
    const started: number[] = [];
    const settled: number[] = [];

    await expect(
      run_tasks_with_concurrency(
        Array.from({ length: 20 }, (_, index) => index),
        3,
        async (item) => {
          started.push(item);
          await sleep(item === 0 ? 1 : 10);
          if (item === 0) throw new Error('dispatch failed');
          settled.push(item);
        },
      ),
    ).rejects.toThrow('dispatch failed');

    expect(started.length).toBeLessThanOrEqual(3);
    expect(settled).toHaveLength(started.length - 1);
  });

  it('rethrows falsy rejection reasons', async () => {
    await expect(
      run_tasks_with_concurrency([1], 1, async () => Promise.reject(undefined)),
    ).rejects.toBeUndefined();
  });
});

async function sleep(duration_ms: number) {
  await new Promise((resolve) => setTimeout(resolve, duration_ms));
}
