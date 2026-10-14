import { parse_retry_after } from '@shared/retry_after';
import { describe, expect, it } from 'vitest';

describe('parse_retry_after', () => {
  it('reads a number of seconds', () => {
    expect(parse_retry_after('3')).toBe(3_000);
    expect(parse_retry_after(' 0.5 ')).toBe(500);
  });

  it('reads an HTTP date as the time left until that date', () => {
    const now_ms = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(parse_retry_after('Wed, 21 Oct 2026 07:28:05 GMT', now_ms)).toBe(5_000);
    expect(parse_retry_after('Wed, 21 Oct 2026 07:27:00 GMT', now_ms)).toBe(0);
  });

  it('returns null when the header is missing or unreadable', () => {
    expect(parse_retry_after(null)).toBeNull();
    expect(parse_retry_after('')).toBeNull();
    expect(parse_retry_after('soon')).toBeNull();
  });
});
