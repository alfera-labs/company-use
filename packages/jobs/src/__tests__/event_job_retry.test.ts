import {
  is_transient_provider_error,
  resolve_retry_for_failed_job,
} from '@coworker/jobs/event_job_retry';
import { ConflictError } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

const t0 = new Date('2026-09-18T07:00:00Z');
const later_by = (ms: number) => new Date(t0.getTime() + ms);

describe('resolve_retry_for_failed_job', () => {
  it('retries a provider connection error three times over ~10 minutes, then gives up', () => {
    const error = new Error('Model provider request error: Connection error.');
    expect(resolve_retry_for_failed_job(error, t0, t0)?.retry_at).toEqual(later_by(30_000));
    expect(resolve_retry_for_failed_job(error, t0, later_by(31_000))?.retry_at).toEqual(
      later_by(31_000 + 120_000),
    );
    expect(resolve_retry_for_failed_job(error, t0, later_by(152_000))?.retry_at).toEqual(
      later_by(152_000 + 480_000),
    );
    expect(resolve_retry_for_failed_job(error, t0, later_by(13 * 60_000))).toBeUndefined();
  });

  it('does not retry a real failure', () => {
    expect(resolve_retry_for_failed_job(new Error('tool input invalid'), t0, t0)).toBeUndefined();
    expect(is_transient_provider_error(new Error('No such file'))).toBe(false);
  });

  it('still retries a session conflict the old way', () => {
    expect(resolve_retry_for_failed_job(new ConflictError('busy'), t0, t0)?.retry_at).toEqual(
      later_by(1_000),
    );
  });
});
