import { give_up_after } from '@shared/give_up_after';
import { run_after_earlier_runs } from '@shared/run_after_earlier_runs';
import { sleep } from '@shared/sleep';
import { describe, expect, it } from 'vitest';

describe('run_after_earlier_runs', () => {
  it('runs the work of one key in call order, also after a run that failed', async () => {
    const order: string[] = [];
    const slow = run_after_earlier_runs('one', async () => {
      await sleep(20);
      order.push('slow');
      throw new Error('slow failed');
    });
    const fast = run_after_earlier_runs('one', async () => order.push('fast'));
    const other_key = run_after_earlier_runs('two', async () => order.push('other key'));

    await expect(slow).rejects.toThrow('slow failed');
    await expect(fast).resolves.toBe(3);
    await other_key;
    expect(order).toEqual(['other key', 'slow', 'fast']);
  });
});

describe('give_up_after', () => {
  it('returns the answer that comes in time, and passes its error on', async () => {
    await expect(give_up_after(Promise.resolve('answer'), 50, 'The engine')).resolves.toBe(
      'answer',
    );
    await expect(
      give_up_after(Promise.reject(new Error('refused')), 50, 'The engine'),
    ).rejects.toThrow('refused');
  });

  it('names who was slow when the time limit comes first', async () => {
    await expect(give_up_after(sleep(200), 10, 'The engine')).rejects.toThrow(
      'The engine did not answer within 10 ms.',
    );
  });
});
