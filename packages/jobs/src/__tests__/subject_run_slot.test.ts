import { env } from '@coworker/config';
import { run_with_a_queue_run_slot } from '@coworker/jobs/event_job_run_slots';
import { afterEach, describe, expect, it } from 'vitest';

const original_cap = env.WORKER_MAX_CONCURRENT_RUNS;
const original_chat_cap = env.WORKER_MAX_CONCURRENT_CHAT_RUNS;

function set_run_cap(cap: number) {
  Object.assign(env, { WORKER_MAX_CONCURRENT_RUNS: cap });
}

function set_chat_run_cap(cap: number) {
  Object.assign(env, { WORKER_MAX_CONCURRENT_CHAT_RUNS: cap });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('run_with_a_queue_run_slot', () => {
  afterEach(() => {
    set_run_cap(original_cap);
    set_chat_run_cap(original_chat_cap);
  });

  it('never runs more tasks at once than WORKER_MAX_CONCURRENT_RUNS', async () => {
    set_run_cap(1);
    let running = 0;
    let most_running_at_once = 0;

    const run_one = () =>
      run_with_a_queue_run_slot(async () => {
        running += 1;
        most_running_at_once = Math.max(most_running_at_once, running);
        await sleep(20);
        running -= 1;
      });

    await Promise.all([run_one(), run_one(), run_one()]);

    expect(most_running_at_once).toBe(1);
  });

  it('runs tasks in parallel up to the cap', async () => {
    set_run_cap(2);
    let started = 0;
    const both_started = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (started >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 5);
    });

    const run_one = () =>
      run_with_a_queue_run_slot(async () => {
        started += 1;
        await both_started;
      });

    await expect(Promise.all([run_one(), run_one()])).resolves.toBeDefined();
  });

  it('frees the slot when a task throws', async () => {
    set_run_cap(1);

    await expect(
      run_with_a_queue_run_slot(async () => {
        throw new Error('task failed');
      }),
    ).rejects.toThrow('task failed');

    const result = await run_with_a_queue_run_slot(async () => 'ran');
    expect(result).toBe('ran');
  });

  it('runs a chat queue while background work holds every background slot', async () => {
    set_run_cap(1);
    set_chat_run_cap(1);
    let release_background = () => {};
    const background_holds = new Promise<void>((resolve) => {
      release_background = resolve;
    });
    const background = run_with_a_queue_run_slot(() => background_holds, {
      queue_key: 'slack:C1:1.0',
    });

    await expect(
      run_with_a_queue_run_slot(async () => 'chat ran', { queue_key: 'session:ses_1' }),
    ).resolves.toBe('chat ran');

    release_background();
    await background;
  });

  it('never runs more chat queues at once than WORKER_MAX_CONCURRENT_CHAT_RUNS', async () => {
    set_chat_run_cap(2);
    let running = 0;
    let most_running_at_once = 0;
    const run_chat = (session_id: string) =>
      run_with_a_queue_run_slot(
        async () => {
          running += 1;
          most_running_at_once = Math.max(most_running_at_once, running);
          await sleep(20);
          running -= 1;
        },
        { queue_key: `session:${session_id}` },
      );

    await Promise.all(['a', 'b', 'c', 'd'].map(run_chat));

    expect(most_running_at_once).toBe(2);
  });
});
