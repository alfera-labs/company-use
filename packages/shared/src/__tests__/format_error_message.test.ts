import { format_error_message } from '@shared/format_error_message';
import { describe, expect, it } from 'vitest';

describe('format_error_message', () => {
  it('returns the message of an Error', () => {
    expect(format_error_message(new TypeError('bad input'), 'fallback')).toBe('bad input');
  });

  it('keeps an empty Error message', () => {
    expect(format_error_message(new Error(''), 'fallback')).toBe('');
  });

  it('names every cause of an AggregateError, not only its summary', () => {
    const failed_write = new AggregateError(
      [new Error('EROFS: read-only file system'), new Error('Archil checkin failed')],
      'E2B file mutation failed.',
    );
    expect(format_error_message(failed_write)).toBe(
      'E2B file mutation failed. EROFS: read-only file system | Archil checkin failed',
    );
  });

  it('returns the fallback for a value that is not an Error', () => {
    expect(format_error_message({ code: 1 }, 'Something went wrong')).toBe('Something went wrong');
  });

  it('converts a value that is not an Error to a string when no fallback is given', () => {
    expect(format_error_message('timeout')).toBe('timeout');
    expect(format_error_message(undefined)).toBe('undefined');
  });
});
