import { describe, expect, it } from 'vitest';
import { read_link_host, read_tool_result_items } from '@/components/app/tool_result_items';

describe('read_tool_result_items', () => {
  it('reads a search result list', () => {
    const items = read_tool_result_items({
      query: 'hair salon',
      results: [
        { title: 'Best salons 2026', url: 'https://www.tripadvisor.com/x', snippet: 'A list.' },
        { title: 'Example Salons', url: 'https://example-salons.com/y' },
      ],
    });
    expect(items).toEqual([
      { title: 'Best salons 2026', url: 'https://www.tripadvisor.com/x', detail: 'A list.' },
      { title: 'Example Salons', url: 'https://example-salons.com/y' },
    ]);
  });

  it('reads a file listing that names its things differently', () => {
    expect(
      read_tool_result_items([
        { kind: 'file', name: '2026-08-25.md', path: 'daily-logs/2026-08-25.md' },
        { kind: 'file', name: 'index.md', path: 'daily-logs/index.md' },
      ]),
    ).toEqual([{ title: '2026-08-25.md' }, { title: 'index.md' }]);
  });

  it('reads grep matches, where the name is a path and the detail is the line', () => {
    expect(
      read_tool_result_items([{ line: 24, path: 'daily-logs/index.md', text: '- Reviewed.' }]),
    ).toEqual([{ title: 'daily-logs/index.md', detail: '- Reviewed.' }]);
  });

  it('reads a tool search, which keeps its list under its own key', () => {
    const items = read_tool_result_items({
      query: 'gmail',
      tools: [{ node_key: 'gmail-find_email-1', description: 'Search the mailbox.' }],
    });
    expect(items).toEqual([{ title: 'gmail-find_email-1', detail: 'Search the mailbox.' }]);
  });

  it('reads a list of plain strings', () => {
    expect(read_tool_result_items(['#general', '#random'])).toEqual([
      { title: '#general' },
      { title: '#random' },
    ]);
  });

  it('is not a list when the result is one thing', () => {
    expect(read_tool_result_items({ ok: true, replacements: 1 })).toEqual([]);
  });

  it('is not a list when its things cannot be named', () => {
    expect(read_tool_result_items([{ count: 1 }, { count: 2 }])).toEqual([]);
  });

  it('is not a list when there is nothing there', () => {
    expect(read_tool_result_items({ results: [] })).toEqual([]);
    expect(read_tool_result_items(null)).toEqual([]);
    expect(read_tool_result_items('some text')).toEqual([]);
  });

  it('keeps a long detail to one readable line', () => {
    const [item] = read_tool_result_items([
      { title: 'Note', text: `${'x'.repeat(400)}\nsecond line` },
    ]);
    expect(item?.detail).toHaveLength(201);
    expect(item?.detail?.endsWith('…')).toBe(true);
  });
});

describe('read_link_host', () => {
  it('says the part of an address a person reads', () => {
    expect(read_link_host('https://www.tripadvisor.com/Hotel_Review-g1')).toBe('tripadvisor.com');
    expect(read_link_host('not a url')).toBe('');
  });
});
