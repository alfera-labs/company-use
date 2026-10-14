import { describe, expect, it } from 'vitest';
import { read_cookie_value } from '@/lib/workos_session';

describe('read_cookie_value', () => {
  it('reads and decodes the named cookie', () => {
    expect(read_cookie_value('a=1; wos-session=x%20y; b=2', 'wos-session')).toBe('x y');
  });

  it('answers undefined for a missing cookie', () => {
    expect(read_cookie_value('a=1', 'wos-session')).toBeUndefined();
    expect(read_cookie_value(null, 'wos-session')).toBeUndefined();
  });

  it('treats an undecodable value as absent instead of throwing', () => {
    expect(read_cookie_value('wos-session=%', 'wos-session')).toBeUndefined();
    expect(read_cookie_value('wos-session=%E0%A4%A', 'wos-session')).toBeUndefined();
  });
});
