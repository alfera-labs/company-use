import { strip_unstorable_characters } from '@shared/nul_bytes';
import { describe, expect, it } from 'vitest';

const nul = String.fromCharCode(0);
const lone_high = String.fromCharCode(0xd83d);
const lone_low = String.fromCharCode(0xdc8d);

describe('strip_unstorable_characters', () => {
  it('removes NUL bytes from a string', () => {
    expect(strip_unstorable_characters(`a${nul}b${nul}`)).toBe('ab');
  });

  it('replaces a lone surrogate with the replacement character', () => {
    expect(strip_unstorable_characters(`quote${lone_high}`)).toBe('quote�');
    expect(strip_unstorable_characters(`${lone_low}quote`)).toBe('�quote');
  });

  it('keeps whole emoji intact', () => {
    expect(strip_unstorable_characters('wedding 💍 quote')).toBe('wedding 💍 quote');
  });

  it('walks arrays, nested objects, and object keys', () => {
    const input = {
      content_text: `PK${nul}${nul}data`,
      parts: [`x${nul}`, { text: `y${lone_high}z` }],
      [`k${lone_low}ey`]: 'value',
    };

    expect(strip_unstorable_characters(input)).toEqual({
      content_text: 'PKdata',
      parts: ['x', { text: 'y�z' }],
      ['k�ey']: 'value',
    });
  });

  it('leaves clean and non-string values untouched', () => {
    expect(strip_unstorable_characters('clean')).toBe('clean');
    expect(strip_unstorable_characters(42)).toBe(42);
    expect(strip_unstorable_characters(null)).toBe(null);
    expect(strip_unstorable_characters(undefined)).toBe(undefined);
    expect(strip_unstorable_characters(true)).toBe(true);
  });
});
