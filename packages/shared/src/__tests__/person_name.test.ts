import { format_person_name } from '@shared/person_name';
import { describe, expect, it } from 'vitest';

describe('format_person_name', () => {
  it('joins the first and last name with one space', () => {
    expect(format_person_name('Ada', 'Lovelace')).toBe('Ada Lovelace');
  });

  it('keeps the one name that exists', () => {
    expect(format_person_name('Ada', null)).toBe('Ada');
    expect(format_person_name(undefined, 'Lovelace')).toBe('Lovelace');
  });

  it('returns the fallback when there is no name', () => {
    expect(format_person_name(null, '', 'ada@example.com')).toBe('ada@example.com');
    expect(format_person_name(null, undefined)).toBe('');
  });
});
