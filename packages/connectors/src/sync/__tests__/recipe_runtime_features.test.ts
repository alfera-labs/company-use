import { build_list_input } from '@connectors/sync/list_request';
import { read_list_page } from '@connectors/sync/read_list_page';
import { to_time_ms } from '@connectors/sync/sync_markers';
import { fill_watermark_template } from '@connectors/sync/watermark_template';
import type { ConnectorSyncObject } from '@connectors/sync_types';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const base_object: ConnectorSyncObject = {
  list_node: 'demo-list_records-1',
  scoped_by: { account: null },
  list_input: { q: 'kind = invoice' },
  page: { items: { $: 'response.rows' } },
  strategy: 'modified_since',
  cursor: {
    field: { $: 'item.updated' },
    param: 'q',
    template: { text: "kind = invoice and updated > '{watermark}'", escape: 'sql_quote' },
  },
  identity: { $: 'item.id' },
  title: { $: 'item.id' },
  content: { $: 'item.id' },
  item_kind: 'record',
};

describe('fill_watermark_template', () => {
  it('doubles a single quote for a SQL string', () => {
    const template = { text: "updated > '{watermark}'", escape: 'sql_quote' as const };
    expect(fill_watermark_template(template, "2026-01-01' OR '1'='1")).toBe(
      "updated > '2026-01-01'' OR ''1''=''1'",
    );
  });

  it('escapes a backslash and a single quote for a Drive query', () => {
    const template = { text: "modifiedTime > '{watermark}'", escape: 'backslash_quote' as const };
    expect(fill_watermark_template(template, "a\\b'c")).toBe("modifiedTime > 'a\\\\b\\'c'");
  });

  it('sends a time literal only for a real time', () => {
    const template = {
      text: 'lastModifiedDateTime gt {watermark}',
      escape: 'time_literal' as const,
    };
    expect(fill_watermark_template(template, '2026-09-01T10:00:00+02:00')).toBe(
      'lastModifiedDateTime gt 2026-09-01T08:00:00.000Z',
    );
    expect(() => fill_watermark_template(template, '2026 or true')).toThrow(/not a time/);
  });
});

describe('build_list_input with a watermark template', () => {
  it('keeps the plain query on a first sync with no watermark', () => {
    expect(build_list_input(base_object, 'account', { scope_id: 'account' })).toEqual({
      q: 'kind = invoice',
    });
  });

  it('replaces the query with the filled template once a watermark exists', () => {
    const input = build_list_input(base_object, 'account', {
      scope_id: 'account',
      watermark: '2026-09-01T00:00:00.000Z',
    });
    expect(input).toEqual({ q: "kind = invoice and updated > '2026-09-01T00:00:00.000Z'" });
  });

  it('formats the watermark by marker_format before it fills the template', () => {
    const cursor = { ...base_object.cursor, marker_format: 'iso_date' as const };
    const input = build_list_input({ ...base_object, cursor } as ConnectorSyncObject, 'account', {
      scope_id: 'account',
      watermark: '2026-09-01T22:15:00Z',
    });
    expect(input.q).toBe("kind = invoice and updated > '2026-09-01'");
  });

  it('writes a watermark into an input whose name has hyphens', () => {
    const object: ConnectorSyncObject = {
      ...base_object,
      list_input: {},
      cursor: { field: { $: 'item.updated' }, param: 'If-Modified-Since' },
    };
    const input = build_list_input(object, 'account', {
      scope_id: 'account',
      watermark: '2026-09-01T00:00:00.000Z',
    });
    expect(input).toEqual({ 'If-Modified-Since': '2026-09-01T00:00:00.000Z' });
  });
});

describe('read_list_page with a last_item cursor', () => {
  const last_item_object: ConnectorSyncObject = {
    ...base_object,
    page: {
      items: { $: 'response.data' },
      cursor_kind: 'last_item',
      cursor_param: 'starting_after',
      next_cursor: { $: 'item.id' },
      has_more: { $: 'response.hasMore' },
      page_size: 2,
    },
  };

  it('reads the next cursor from the last item on a full page', () => {
    const page = read_list_page(last_item_object, {
      data: [{ id: 'in_1' }, { id: 'in_2' }],
      hasMore: true,
    });
    expect(page.next_cursor).toBe('in_2');
  });

  it('ends when has_more is false, the page is short, or the page is empty', () => {
    const full = { data: [{ id: 'in_1' }, { id: 'in_2' }] };
    expect(read_list_page(last_item_object, { ...full, hasMore: false }).next_cursor).toBeNull();
    const short = { data: [{ id: 'in_3' }], hasMore: true };
    expect(read_list_page(last_item_object, short).next_cursor).toBeNull();
    expect(read_list_page(last_item_object, { data: [], hasMore: true }).next_cursor).toBeNull();
  });

  it('sends the stored last id back as the page cursor', () => {
    const input = build_list_input(last_item_object, 'account', {
      scope_id: 'account',
      page_cursor: 'in_2',
    });
    expect(input.starting_after).toBe('in_2');
  });
});

describe('$join', () => {
  const item = { first: 'Ada', middle: null, last: ' Lovelace ', none: '' };

  it('joins the present parts with the separator', () => {
    const expression = {
      $join: { parts: [{ $: 'item.first' }, { $: 'item.middle' }, { $: 'item.last' }] },
    };
    expect(evaluate_value_expression(expression, { item })).toBe('Ada Lovelace');
  });

  it('answers null when no part has text, so $default falls through', () => {
    const expression = {
      $default: [{ $join: { parts: [{ $: 'item.none' }, { $: 'item.middle' }] } }, 'fallback'],
    };
    expect(evaluate_value_expression(expression, { item })).toBe('fallback');
  });

  it('refuses a $join without a parts array', () => {
    expect(() => evaluate_value_expression({ $join: { parts: 'x' } }, { item })).toThrow(
      /\$join takes/,
    );
  });
});

describe('to_time_ms', () => {
  it('reads the /Date(ms+zone)/ marker some APIs send', () => {
    expect(to_time_ms('/Date(1757000000000+0000)/')).toBe(1_757_000_000_000);
  });
});
