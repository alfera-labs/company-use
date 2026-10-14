import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolDetailTree } from '@/components/prompt-kit/tool_detail_tree';

function render(value: unknown) {
  return renderToStaticMarkup(createElement(ToolDetailTree, { value }));
}

function text_of(value: unknown) {
  return render(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

describe('ToolDetailTree', () => {
  it('walks into a list instead of printing JSON at it', () => {
    const html = render([
      { name: 'Gmail', quality: 'GREAT' },
      { name: 'Shortwave', quality: 'GREAT' },
    ]);

    expect(html).not.toContain('{&quot;');
    expect(html).not.toContain('[{');
    expect(text_of([{ name: 'Gmail' }, { name: 'Shortwave' }])).toBe(
      '1 name Gmail 2 name Shortwave',
    );
  });

  it('numbers list items, so a row can be pointed at', () => {
    expect(text_of(['a', 'b', 'c'])).toBe('1 a 2 b 3 c');
  });

  it('parses a value that is really JSON hiding in a string', () => {
    const stdout = '{"connections":[{"serviceName":"Gmail"}]}';

    expect(text_of({ log: stdout })).toBe('log json connections 1 serviceName Gmail');
  });

  it('leaves a string that only starts like JSON as text', () => {
    expect(text_of({ note: '{not json at all' })).toBe('note {not json at all');
  });

  it('says empty and none in words rather than brackets', () => {
    expect(text_of({ files: [], cursor: null, extras: {} })).toBe(
      'files empty cursor none extras empty',
    );
  });

  it('keeps a multi-line string as real lines', () => {
    const html = render({ stdout: 'first\nsecond' });

    expect(html).toContain('<pre');
    expect(html).toContain('first\nsecond');
  });

  it('renders every item of a long list — nothing is summarised away', () => {
    const files = Array.from({ length: 60 }, (_, index) => ({ name: `file_${index}.md` }));
    const html = render(files);

    expect(html).toContain('file_0.md');
    expect(html).toContain('file_59.md');
    expect(html).toContain('>60<');
  });

  it('falls back to the whole value rather than losing content at absurd depth', () => {
    let nested: unknown = { leaf: 'bottom' };
    for (let level = 0; level < 12; level += 1) nested = { down: nested };

    expect(text_of(nested)).toContain('bottom');
  });
});
