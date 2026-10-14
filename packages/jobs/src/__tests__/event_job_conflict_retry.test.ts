import { resolve_retry_for_failed_job } from '@coworker/jobs/event_job_retry';
import { ConflictError } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-07-06T17:06:14.000Z');
const ms_ago = (ms: number) => new Date(now.getTime() - ms);

describe('resolve_retry_for_failed_job', () => {
  it('retries a session-busy conflict with backoff instead of dropping the message', () => {
    const retry = resolve_retry_for_failed_job(
      new ConflictError('Session already has an active runtime run'),
      ms_ago(0),
      now,
    );

    expect(retry).toBeDefined();
    expect(retry?.retry_at.getTime()).toBe(now.getTime() + 1_000);
  });

  it('backs off further as the message waits longer, capped at a ceiling', () => {
    const mid_wait = resolve_retry_for_failed_job(
      new ConflictError('Session already has an active runtime run'),
      ms_ago(25_000),
      now,
    );
    expect(mid_wait?.retry_at.getTime()).toBe(now.getTime() + 4_000);

    const long_wait = resolve_retry_for_failed_job(
      new ConflictError('Session already has an active runtime run'),
      ms_ago(120_000),
      now,
    );
    expect(long_wait?.retry_at.getTime()).toBe(now.getTime() + 60_000);
  });

  it('keeps retrying a message queued behind a legitimately long run (past the old ~4min cap)', () => {
    const retry = resolve_retry_for_failed_job(
      new ConflictError('Session already has an active runtime run'),
      ms_ago(10 * 60 * 1000),
      now,
    );

    expect(retry).toBeDefined();
    expect(retry?.retry_at.getTime()).toBe(now.getTime() + 60_000);
  });

  it('gives up once the message has waited past the max wait, so a stuck session cannot loop forever', () => {
    expect(
      resolve_retry_for_failed_job(
        new ConflictError('Session already has an active runtime run'),
        ms_ago(30 * 60 * 1000),
        now,
      ),
    ).toBeUndefined();
  });

  it('does not retry a non-conflict error (a real failure is terminal)', () => {
    expect(resolve_retry_for_failed_job(new Error('boom'), ms_ago(0), now)).toBeUndefined();
  });
});
