import { group_records_by_bucket, merge_bucket_metadata } from '@connectors/sync/bucket_records';
import { map_sync_record } from '@connectors/sync/map_sync_record';
import { to_content_text } from '@connectors/sync/record_text';
import type { ConnectorSyncObject } from '@connectors/sync_types';
import type { ConnectorApp } from '@connectors/types';
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

function build_app(overrides: Partial<ConnectorApp> = {}): ConnectorApp {
  return {
    app_key: 'slack',
    display_name: 'Slack',
    base_url: 'https://slack.invalid',
    rate_limits: { rpm: 60, concurrency: 1, burst: 1 },
    auth: { kind: 'none' },
    ...overrides,
  };
}

describe('map_sync_record', () => {
  const scope = { id: 'C1', label: 'general' };
  const app = build_app();

  it('reads one record through the recipe', () => {
    const record = map_sync_record(app, slack_recipe, {
      item: { ts: '1757000000.000100', text: 'the renewal is due friday' },
      scope,
    });
    expect(record).toMatchObject({
      external_item_id: '1757000000.000100',
      title: 'the renewal is due friday',
      content_text: 'the renewal is due friday',
      item_kind: 'message',
      external_container_id: 'C1',
      container_path: 'general',
      cursor_value: '1757000000.000100',
      bucket_day: '2025-09-04',
      tombstoned: false,
    });
  });

  it('refuses a record with no identity, rather than storing a nameless document', () => {
    expect(() => map_sync_record(app, slack_recipe, { item: { text: 'no ts' }, scope })).toThrow(
      /identity/,
    );
  });

  it('reads a relationship as a link naming the recipe`s relation, not only its family', () => {
    const recipe: ConnectorSyncObject = {
      ...slack_recipe,
      relationships: { reply_to: { $: 'item.thread_ts' } },
    };
    const record = map_sync_record(app, recipe, {
      item: { ts: '2', text: 'reply', thread_ts: '1' },
      scope,
    });
    expect(record.links).toEqual([{ relation: 'reply_to', link_family: 'thread', to: '1' }]);
  });

  it('names an app-declared relation that is not built in', () => {
    const recipe: ConnectorSyncObject = {
      ...slack_recipe,
      relationships: { owns_deal: { $: 'item.owner_id' } },
    };
    const custom_app = build_app({
      relation_records: [
        {
          relation: 'owns_deal',
          link_family: 'mentions',
          inverse_relation: null,
          allowed_link_methods: [],
        },
      ],
    });
    const record = map_sync_record(custom_app, recipe, {
      item: { ts: '3', text: 'deal', owner_id: 'u1' },
      scope,
    });
    expect(record.links).toEqual([{ relation: 'owns_deal', link_family: 'mentions', to: 'u1' }]);
  });

  it('keeps files on the record', () => {
    const recipe: ConnectorSyncObject = {
      ...slack_recipe,
      files: { $: 'item.files' },
    };
    const record = map_sync_record(app, recipe, {
      item: { ts: '4', text: 'has a file', files: [{ id: 'f1', name: 'report.pdf' }] },
      scope,
    });
    expect(record.files).toEqual([{ id: 'f1', name: 'report.pdf' }]);
  });
});

describe('to_content_text', () => {
  it('joins an array of strings, which is how a page`s blocks arrive', () => {
    expect(to_content_text(['one', 'two'])).toBe('one\ntwo');
  });

  it('writes a record as JSON with sorted keys', () => {
    expect(to_content_text({ b: 2, a: 1 })).toBe(to_content_text({ a: 1, b: 2 }));
    expect(to_content_text({ b: 2, a: 1 })).toContain('"a": 1');
  });
});

describe('group_records_by_bucket', () => {
  it('puts one day of one channel in one bucket, oldest line first', () => {
    const scope = { id: 'C1', label: 'general' };
    const app = build_app();
    const records = ['1757000200.000000', '1757000100.000000', '1757100000.000000'].map((ts) =>
      map_sync_record(app, slack_recipe, { item: { ts, text: `at ${ts}` }, scope }),
    );

    const buckets = group_records_by_bucket(records);
    expect([...buckets.keys()]).toEqual(['C1:2025-09-04', 'C1:2025-09-05']);
    expect(buckets.get('C1:2025-09-04')?.map((record) => record.content_text)).toEqual([
      'at 1757000100.000000',
      'at 1757000200.000000',
    ]);
  });
});

describe('merge_bucket_metadata', () => {
  it('counts records and unions array metadata across the bucket', () => {
    const scope = { id: 'C1', label: 'general' };
    const app = build_app();
    const recipe: ConnectorSyncObject = {
      ...slack_recipe,
      metadata: { reply_authors: { $: 'item.reply_authors' } },
    };
    const records = [
      map_sync_record(app, recipe, {
        item: { ts: '1', text: 'a', reply_authors: ['alice'] },
        scope,
      }),
      map_sync_record(app, recipe, {
        item: { ts: '2', text: 'b', reply_authors: ['bob'] },
        scope,
      }),
    ];
    expect(merge_bucket_metadata(records)).toEqual({
      reply_authors: ['alice', 'bob'],
      record_count: 2,
      participants: ['alice', 'bob'],
    });
  });
});
