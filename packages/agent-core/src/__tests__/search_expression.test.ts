import { search_expression } from '@agent-core/environment/search_expression';
import { describe, expect, it } from 'vitest';

describe('search_expression', () => {
  it('takes an inline case flag the way ripgrep does', () => {
    const expression = search_expression('(?i)codename', undefined);

    expect(expression.test('Project CODENAME: teal')).toBe(true);
    expect(expression.flags).toBe('i');
  });

  it('takes several inline flags at once', () => {
    expect(search_expression('(?im)^total', undefined).flags).toBe('im');
  });

  it('keeps a plain pattern case sensitive unless told otherwise', () => {
    expect(search_expression('codename', undefined).test('CODENAME')).toBe(false);
    expect(search_expression('codename', false).test('CODENAME')).toBe(true);
  });

  it('leaves a group that is not a flag alone', () => {
    expect(search_expression('(?:alpha|bravo)-\\d+', undefined).test('bravo-2209')).toBe(true);
  });
});
