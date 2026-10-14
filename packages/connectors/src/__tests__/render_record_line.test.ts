import { format_line, to_epoch_ms } from '@connectors/sync/format_line';
import type { ConnectorPersonRecord } from '@connectors/sync/read_directory_page';
import {
  collect_line_participants,
  collect_record_index,
  record_index_cap,
  render_record_line,
} from '@connectors/sync/render_record_line';
import { build_person_directory } from '@connectors/sync/resolve_record_text';
import type { ConnectorSyncLine, ConnectorSyncTextResolver } from '@connectors/sync_types';
import { describe, expect, it } from 'vitest';

const ada: ConnectorPersonRecord = {
  external_person_id: 'U01',
  display_name: 'Ada Lovelace',
  email: undefined,
  person_kind: 'member',
  raw: { id: 'U01' },
};

const bob: ConnectorPersonRecord = {
  external_person_id: 'U02',
  display_name: 'Bob',
  email: undefined,
  person_kind: 'member',
  raw: { id: 'U02' },
};

const mention_resolver: ConnectorSyncTextResolver = {
  pattern: '<@([A-Z0-9]+)>',
  lookup: 'person',
  render: '@{display_name} ({external_person_id})',
};

const line_recipe: ConnectorSyncLine = {
  author: { $: 'item.author_id' },
  time: { $: 'item.ts' },
};

describe('format_line', () => {
  it('renders author, clock, and text when a readable time is given', () => {
    expect(format_line('Ada', Date.UTC(2026, 0, 2, 9, 5), 'ship it')).toBe('[Ada · 09:05] ship it');
  });

  it('drops the clock when no time is given', () => {
    expect(format_line('Ada', undefined, 'ship it')).toBe('[Ada] ship it');
  });

  it('drops the clock when the time is not a readable instant', () => {
    expect(format_line('Ada', Number.NaN, 'ship it')).toBe('[Ada] ship it');
  });
});

describe('to_epoch_ms', () => {
  it('reads a Slack-style epoch-seconds string as milliseconds', () => {
    expect(to_epoch_ms('1700000000.000100')).toBeCloseTo(1700000000000.1, 0);
  });

  it('reads a bare epoch-seconds number the same way', () => {
    expect(to_epoch_ms(1700000000)).toBe(1700000000000);
  });

  it('reads an ISO string as a normal instant', () => {
    expect(to_epoch_ms('2026-01-02T09:05:00.000Z')).toBe(Date.UTC(2026, 0, 2, 9, 5));
  });

  it('answers undefined for an unreadable marker', () => {
    expect(to_epoch_ms('not a time')).toBeUndefined();
  });
});

describe('render_record_line: a plain-text record', () => {
  it('resolves the author through a directory hit, renders the Slack ts clock, and keeps the raw marker in the record_index', () => {
    const people = build_person_directory([ada]);
    const rendered = render_record_line(line_recipe, [mention_resolver], people, {
      item: { author_id: 'U01', ts: '1700000000.000100' },
      content: 'ship it',
      external_id: 'msg_1',
    });
    expect(rendered.text).toBe('[Ada Lovelace · 22:13] ship it');
    expect(rendered.unresolved).toBe(0);
    expect(rendered.participants).toEqual([{ id: 'U01', name: 'Ada Lovelace' }]);
    expect(rendered.record_index_entry).toEqual({
      external_id: 'msg_1',
      ts: '1700000000.000100',
      author_id: 'U01',
    });
  });

  it('falls back to the resolvers when the raw author is not a direct directory hit', () => {
    const people = build_person_directory([ada]);
    const rendered = render_record_line(line_recipe, [mention_resolver], people, {
      item: { author_id: 'mentions <@U01>', ts: 1000 },
      content: 'hi',
      external_id: 'msg_2',
    });
    expect(rendered.text).toContain('@Ada Lovelace (U01)');
  });

  it('counts an unresolved mention inside the body text, not only the author', () => {
    const rendered = render_record_line(
      line_recipe,
      [mention_resolver],
      build_person_directory([]),
      {
        item: { author_id: 'U01', ts: 1000 },
        content: 'ping <@U99>',
        external_id: 'msg_3',
      },
    );
    expect(rendered.unresolved).toBe(1);
  });

  it('joins an array of plain strings with newlines', () => {
    const rendered = render_record_line(line_recipe, [], build_person_directory([ada]), {
      item: { author_id: 'U01', ts: 1000 },
      content: ['line one', 'line two'],
      external_id: 'msg_4',
    });
    expect(rendered.text).toContain('line one\nline two');
  });

  it('falls back to the cursor value when the record has no time of its own', () => {
    const rendered = render_record_line(
      { author: { $: 'item.author_id' } },
      [],
      build_person_directory([ada]),
      {
        item: { author_id: 'U01' },
        content: 'no time field',
        external_id: 'msg_5',
        cursor_value: '1700000005.000000',
      },
    );
    expect(rendered.record_index_entry.ts).toBe('1700000005.000000');
  });
});

describe('render_record_line: a thread of reply objects', () => {
  const thread_recipe: ConnectorSyncLine = {
    author: { $: 'item.author' },
    time: { $: 'item.ts' },
    text: { $: 'item.text' },
  };

  it('renders one line per reply, each with its own author, and exactly one record_index entry', () => {
    const people = build_person_directory([ada, bob]);
    const rendered = render_record_line(thread_recipe, [], people, {
      item: { author: 'U01', ts: '1700000000.000000' },
      content: [
        { author: 'U01', ts: '1700000001.000000', text: 'q' },
        { author: 'U02', ts: '1700000002.000000', text: 'a' },
      ],
      external_id: 'thread_1',
    });

    expect(rendered.text).toBe('[Ada Lovelace · 22:13] q\n[Bob · 22:13] a');
    expect(rendered.participants).toEqual(
      expect.arrayContaining([
        { id: 'U01', name: 'Ada Lovelace' },
        { id: 'U02', name: 'Bob' },
      ]),
    );
    expect(rendered.participants).toHaveLength(2);
    expect(rendered.record_index_entry).toEqual({
      external_id: 'thread_1',
      ts: '1700000000.000000',
      author_id: 'U01',
    });
  });

  it('reads each reply element with its own author/time/text expressions', () => {
    const rendered = render_record_line(thread_recipe, [], build_person_directory([ada]), {
      item: { author: 'U01', ts: '1700000000.000000' },
      content: [{ author: 'U01', ts: '1700000001.000000', text: 'q' }],
      external_id: 'thread_2',
    });
    expect(rendered.text).toBe('[Ada Lovelace · 22:13] q');
  });
});

describe('collect_line_participants and collect_record_index', () => {
  it('dedupes participants by id and caps the record index at 500, one entry per record', () => {
    const people = build_person_directory([ada]);
    const rows = Array.from({ length: 510 }, (_, index) =>
      render_record_line(line_recipe, [], people, {
        item: { author_id: 'U01', ts: String(index) },
        content: `message ${index}`,
        external_id: `msg_${index}`,
      }),
    );

    expect(collect_line_participants(rows)).toEqual([{ id: 'U01', name: 'Ada Lovelace' }]);
    const record_index = collect_record_index(rows);
    expect(record_index).toHaveLength(record_index_cap);
    expect(record_index[0]).toEqual({ external_id: 'msg_0', ts: '0', author_id: 'U01' });
  });

  it('keeps exactly one record_index entry for a record with three reply lines', () => {
    const people = build_person_directory([ada]);
    const rendered = render_record_line(
      { author: { $: 'item.thread_starter_id' }, time: { $: 'item.thread_ts' } },
      [],
      people,
      {
        item: { thread_starter_id: 'U01', thread_ts: '1700000000.000000' },
        content: [
          { author: 'U01', text: 'one' },
          { author: 'U01', text: 'two' },
          { author: 'U01', text: 'three' },
        ],
        external_id: 'thread_3',
      },
    );
    expect(collect_record_index([rendered])).toHaveLength(1);
  });
});
