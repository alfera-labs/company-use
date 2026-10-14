import { wake_the_waiters, watch_for_wake } from '@coworker/core/db/wake_channel';
import { describe, expect, it } from 'vitest';

const channel = 'approval_answered';

function how_long(work: () => Promise<unknown>) {
  const started = Date.now();
  return work().then(() => Date.now() - started);
}

describe('watch_for_wake', () => {
  it('resolves a wait that is already running', async () => {
    const watch = watch_for_wake(channel, 'job_1');
    const waited = how_long(() => watch.wait_for_a_wake(5_000));

    setTimeout(() => wake_the_waiters(channel, 'job_1'), 5);
    expect(await waited).toBeLessThan(400);
    watch.stop();
  });

  it('remembers a wake that lands before anybody waits', async () => {
    const watch = watch_for_wake(channel, 'job_2');
    wake_the_waiters(channel, 'job_2');

    expect(await how_long(() => watch.wait_for_a_wake(5_000))).toBeLessThan(400);
    watch.stop();
  });

  it('takes a remembered wake only once', async () => {
    const watch = watch_for_wake(channel, 'job_3');
    wake_the_waiters(channel, 'job_3');
    await watch.wait_for_a_wake(5_000);

    expect(await how_long(() => watch.wait_for_a_wake(120))).toBeGreaterThanOrEqual(100);
    watch.stop();
  });

  it('ignores a wake meant for another question', async () => {
    const watch = watch_for_wake(channel, 'job_4');
    setTimeout(() => wake_the_waiters(channel, 'somebody_elses_job'), 5);

    expect(await how_long(() => watch.wait_for_a_wake(120))).toBeGreaterThanOrEqual(100);
    watch.stop();
  });

  it('wakes every waiter on the same question', async () => {
    const first = watch_for_wake(channel, 'job_5');
    const second = watch_for_wake(channel, 'job_5');
    const both = Promise.all([first.wait_for_a_wake(5_000), second.wait_for_a_wake(5_000)]);

    setTimeout(() => wake_the_waiters(channel, 'job_5'), 5);
    expect(await how_long(() => both)).toBeLessThan(400);
    first.stop();
    second.stop();
  });

  it('stops waking a watch that has stopped', async () => {
    const watch = watch_for_wake(channel, 'job_6');
    watch.stop();
    wake_the_waiters(channel, 'job_6');

    expect(await how_long(() => watch.wait_for_a_wake(120))).toBeGreaterThanOrEqual(100);
  });

  it('gives up the wait when the run is cancelled', async () => {
    const watch = watch_for_wake(channel, 'job_7');
    const cancel = new AbortController();
    const waited = how_long(() => watch.wait_for_a_wake(5_000, cancel.signal));

    setTimeout(() => cancel.abort(), 5);
    expect(await waited).toBeLessThan(400);
    watch.stop();
  });
});
