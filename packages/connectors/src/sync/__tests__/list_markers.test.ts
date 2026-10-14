import { build_list_input, write_input_path } from '@connectors/sync/list_request';
import { read_list_page } from '@connectors/sync/read_list_page';
import {
  is_newer_marker,
  move_marker_back,
  to_bucket_day,
  watermark_to_send,
} from '@connectors/sync/sync_markers';
import type { ConnectorSyncObject } from '@connectors/sync_types';
import { describe, expect, it } from 'vitest';

const slack_recipe: ConnectorSyncObject = {
  list_node: 'slack-list_messages-1',
  scoped_by: { channels: 'channels[].channel_id' },
  list_input: { limit: 200 },
  page: {
    cursor_param: 'channels[].cursor',
    items: { $: 'response.channels.0.messages' },
    next_cursor: { $: 'response.channels.0.next_cursor' },
  },
  strategy: 'append_log',
  cursor: { field: { $: 'item.ts' }, param: 'oldest' },
  edit_window_days: 14,
  identity: { $: 'item.ts' },
  title: { $: 'item.text' },
  content: { $: 'item.text' },
  item_kind: 'message',
  container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
  bucket: { by: 'day', of: { $: 'item.ts' } },
};

describe('write_input_path', () => {
  it('writes into the first row of a plural node`s array', () => {
    const input: Record<string, unknown> = {};
    write_input_path(input, 'channels[].channel_id', 'C1');
    write_input_path(input, 'channels[].cursor', 'page-2');
    expect(input).toEqual({ channels: [{ channel_id: 'C1', cursor: 'page-2' }] });
  });

  it('writes nothing when there is no value', () => {
    const input: Record<string, unknown> = {};
    write_input_path(input, 'since', undefined);
    expect(input).toEqual({});
  });
});

describe('build_list_input', () => {
  it('puts the scope, the page cursor and the watermark where the recipe says', () => {
    const input = build_list_input(slack_recipe, 'channels', {
      scope_id: 'C1',
      page_cursor: 'next-page',
      watermark: '1757000000.000000',
    });
    expect(input).toEqual({
      limit: 200,
      channels: [{ channel_id: 'C1', cursor: 'next-page' }],
      oldest: '1757000000.000000',
    });
  });

  it('refuses a scope the recipe is not written for', () => {
    expect(() => build_list_input(slack_recipe, 'folders', { scope_id: 'C1' })).toThrow(
      /not scoped by folders/,
    );
  });

  it('shares no mutable object between two calls', () => {
    const first = build_list_input(slack_recipe, 'channels', { scope_id: 'C1' });
    const second = build_list_input(slack_recipe, 'channels', { scope_id: 'C2' });
    expect(first.channels).not.toBe(second.channels);
    write_input_path(first, 'channels[].cursor', 'page-only-on-first');
    expect((second.channels as { cursor?: string }[])[0]?.cursor).toBeUndefined();
  });
});

describe('read_list_page', () => {
  it('reads the failure a plural node reported for this scope', () => {
    const recipe: ConnectorSyncObject = {
      ...slack_recipe,
      page: { ...slack_recipe.page, error: { $: 'response.channels.0.error_code' } },
    };
    const page = read_list_page(recipe, {
      channels: [{ messages: [], next_cursor: null, error_code: 'unauthorized' }],
    });
    expect(page.error_code).toBe('unauthorized');
  });

  it('reads an empty last page as the end', () => {
    const page = read_list_page(slack_recipe, { channels: [{ messages: [], next_cursor: null }] });
    expect(page).toEqual({ items: [], next_cursor: null, error_code: null });
  });

  it('reads a bare-array answer through an items path of response', () => {
    const recipe: ConnectorSyncObject = { ...slack_recipe, page: { items: { $: 'response' } } };
    expect(read_list_page(recipe, [{ id: 'a' }]).items).toEqual([{ id: 'a' }]);
  });

  it('counts the next offset by page_size and stops on a short page', () => {
    const recipe: ConnectorSyncObject = {
      ...slack_recipe,
      page: {
        items: { $: 'response.rows' },
        cursor_param: 'offset',
        cursor_kind: 'offset',
        page_size: 2,
      },
    };
    expect(read_list_page(recipe, { rows: [1, 2] }).next_cursor).toBe('2');
    expect(read_list_page(recipe, { rows: [1, 2] }, '2').next_cursor).toBe('4');
    expect(read_list_page(recipe, { rows: [1] }, '4').next_cursor).toBeNull();
  });

  it('counts the next page number from first_cursor and stops on an empty page', () => {
    const recipe: ConnectorSyncObject = {
      ...slack_recipe,
      page: {
        items: { $: 'response.rows' },
        cursor_param: 'page',
        cursor_kind: 'page_number',
        first_cursor: 0,
      },
    };
    expect(read_list_page(recipe, { rows: [1] }).next_cursor).toBe('1');
    expect(read_list_page(recipe, { rows: [] }, '1').next_cursor).toBeNull();
  });
});

describe('markers', () => {
  it('reads epoch seconds and ISO time the same way', () => {
    expect(to_bucket_day('1757000000.000100')).toBe('2025-09-04');
    expect(to_bucket_day('2026-09-04T10:00:00Z')).toBe('2026-09-04');
  });

  it('keeps a marker`s own format when it moves it back', () => {
    expect(move_marker_back('1757000000.000000', 60_000)).toBe('1756999940.000000');
    expect(move_marker_back('2026-09-04T10:00:00.000Z', 60_000)).toBe('2026-09-04T09:59:00.000Z');
  });

  it('compares markers as time, not as text', () => {
    expect(is_newer_marker('1757000000.000000', '999999999.000000')).toBe(true);
    expect(is_newer_marker('2026-09-04T10:00:00Z', null)).toBe(true);
  });
});

describe('watermark_to_send', () => {
  const now = new Date('2026-09-04T12:00:00Z');

  it('sends nothing on a first sweep with no initial_lookback_days', () => {
    expect(watermark_to_send(slack_recipe, null, now)).toBeUndefined();
  });

  it('sends now minus initial_lookback_days in ISO time by default', () => {
    const recipe: ConnectorSyncObject = {
      ...slack_recipe,
      cursor: { field: { $: 'item.ts' }, param: 'oldest', initial_lookback_days: 365 },
    };
    const sent = watermark_to_send(recipe, null, now);
    expect(sent).toBeDefined();
    expect(new Date(sent as string).getUTCFullYear()).toBe(2025);
  });

  it('sends now minus initial_lookback_days in epoch seconds when marker_format asks for it', () => {
    const { bucket: _bucket, ...without_bucket } = slack_recipe;
    const recipe: ConnectorSyncObject = {
      ...without_bucket,
      cursor: {
        field: { $: 'item.ts' },
        param: 'oldest',
        initial_lookback_days: 365,
        marker_format: 'epoch_seconds',
      },
    };
    const sent = watermark_to_send(recipe, null, now);
    expect(sent).toMatch(/^\d+\.\d+$/);
    const expected_ms = now.getTime() - 365 * 24 * 60 * 60 * 1000;
    expect(Number(sent)).toBeCloseTo(expected_ms / 1000, 0);
  });

  it('re-reads the edit window from the start of the day it opens on', () => {
    const watermark = String(Math.trunc(now.getTime() / 1000));
    const sent = watermark_to_send(slack_recipe, watermark, now);
    expect(new Date(Number(sent) * 1000).toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });
});
