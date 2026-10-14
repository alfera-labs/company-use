import { is_abort_error } from '@api/lib/abort_error';
import { describe, expect, it } from 'vitest';

describe('is_abort_error', () => {
  it('matches the OpenAI SDK abort error raised when a run is cancelled', () => {
    const error = Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
    expect(is_abort_error(error)).toBe(true);
  });

  it('matches a DOMException-style AbortError', () => {
    const error = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    expect(is_abort_error(error)).toBe(true);
  });

  it('matches a plain error whose message says the request was aborted', () => {
    expect(is_abort_error(new Error('Request was aborted.'))).toBe(true);
  });

  it('matches a Node abort code even without an abort message', () => {
    const error = Object.assign(new Error('boom'), { code: 'ABORT_ERR' });
    expect(is_abort_error(error)).toBe(true);
  });

  it('does not match a real network failure that must still crash the process', () => {
    const error = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    expect(is_abort_error(error)).toBe(false);
  });

  it('does not match unrelated aborted work that should still hit the global crash path', () => {
    expect(is_abort_error(new Error('database transaction aborted after deadlock'))).toBe(false);
  });

  it('does not match an ordinary error or non-error values', () => {
    expect(is_abort_error(new Error('Runtime completed without an assistant message'))).toBe(false);
    expect(is_abort_error('aborted')).toBe(false);
    expect(is_abort_error(null)).toBe(false);
    expect(is_abort_error(undefined)).toBe(false);
  });
});
