import github_app from '@connectors/apps/github/app.json' with { type: 'json' };
import gmail_app from '@connectors/apps/gmail/app.json' with { type: 'json' };
import slack_app from '@connectors/apps/slack/app.json' with { type: 'json' };
import { load_connector_app } from '@connectors/load_definition';
import { build_connector_registry, get_connector_node } from '@connectors/registry';
import { get_sync_objects } from '@connectors/sync_scope';
import { describe, expect, it } from 'vitest';

const list_records_node = {
  node_key: 'demo-list_records-1',
  description: 'List demo records.',
  implementation: 'execute',
  input_schema: { type: 'object', properties: { object_type: { type: 'string' } } },
  output_schema: { type: 'object', properties: { records: { type: 'array' } } },
};

const valid_object = {
  list_node: 'demo-list_records-1',
  scoped_by: { objects: 'object_type' },
  page: { cursor_param: 'cursor', items: { $: 'response.records' } },
  strategy: 'relist_diff',
  identity: { $: 'item.id' },
  title: { $: 'item.name' },
  content: { $: 'item.body' },
  item_kind: 'record',
};

function build_app(
  objects: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  dimension_overrides: Record<string, unknown> = {},
) {
  return {
    app_key: 'demo',
    display_name: 'Demo',
    base_url: 'https://demo.invalid',
    rate_limits: { rpm: 60, concurrency: 1, burst: 1 },
    auth: { kind: 'none' },
    sync: {
      dimensions: [
        {
          key: 'objects',
          label: 'Objects',
          shape: 'flat',
          browse_node: 'demo-list_records-1',
          ...dimension_overrides,
        },
      ],
      ...(Object.keys(objects).length > 0 ? { objects } : {}),
      ...overrides,
    },
  };
}

function load(
  objects: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  dimension_overrides: Record<string, unknown> = {},
) {
  return load_connector_app(
    'apps/demo/app.json',
    build_app(objects, overrides, dimension_overrides),
  );
}

describe('sync objects in app.json', () => {
  it('loads a recipe and keeps it on the app record', () => {
    const app = load({ record: valid_object });
    expect(app.sync?.objects?.record).toMatchObject({
      strategy: 'relist_diff',
      item_kind: 'record',
    });
  });

  it('refuses a key nobody defined, because a typo there reads as no rule at all', () => {
    expect(() => load({ record: { ...valid_object, strategie: 'relist_diff' } })).toThrow(
      /invalid/,
    );
  });

  it('refuses a strategy and a cursor that disagree', () => {
    expect(() => load({ record: { ...valid_object, strategy: 'modified_since' } })).toThrow(
      /needs a cursor/,
    );
    expect(() =>
      load({
        record: { ...valid_object, cursor: { field: { $: 'item.updated' }, param: 'since' } },
      }),
    ).toThrow(/no cursor to send/);
    expect(() => load({ record: { ...valid_object, edit_window_days: 14 } })).toThrow(
      /only append_log/,
    );
  });

  it('refuses a scope the app never offers', () => {
    expect(() =>
      load({ record: { ...valid_object, scoped_by: { folders: 'folder_id' } } }),
    ).toThrow(/not a declared dimension/);
  });

  it('refuses a malformed value expression at load, not at the first sweep', () => {
    expect(() =>
      load({ record: { ...valid_object, title: { $mpa: { from: 'x', to: 'y' } } } }),
    ).toThrow(/malformed value expression/);
    expect(() =>
      load({
        record: { ...valid_object, content: { $map: { from: 'response.records', to: 1 } } },
      }),
    ).toThrow(/malformed value expression/);
  });

  it('keeps a metadata map, and refuses a malformed expression inside it', () => {
    const app = load({
      record: { ...valid_object, metadata: { author: { $: 'item.author' }, kind: 'record' } },
    });
    expect(app.sync?.objects?.record?.metadata).toEqual({
      author: { $: 'item.author' },
      kind: 'record',
    });
    expect(() =>
      load({ record: { ...valid_object, metadata: { author: { $nope: 'item.author' } } } }),
    ).toThrow(/malformed value expression/);
  });

  it('refuses a read_node content that forgot how to read its text', () => {
    expect(() =>
      load({
        record: {
          ...valid_object,
          content: { read_node: 'demo-read_blocks-1', input: {} },
        },
      }),
    ).toThrow(/invalid read_node content/);
  });

  it('refuses a list node nobody registered', () => {
    expect(() =>
      build_connector_registry(
        [
          {
            source_path: 'apps/demo/app.json',
            definition: build_app({ record: { ...valid_object, list_node: 'demo-missing-1' } }),
          },
        ],
        [
          {
            source_path: 'apps/demo/list_records/v1/node.json',
            definition: list_records_node,
            execute_module: { execute: async () => ({ records: [] }) },
          },
        ],
      ),
    ).toThrow(/not a registered node/);
  });
});

describe('the ACL sync extensions', () => {
  it('refuses file_fetch_input with no files expression to fetch', () => {
    expect(() =>
      load(
        { record: { ...valid_object, file_fetch_input: { id: { $: 'item.id' } } } },
        { file_fetch: { node: 'demo-fetch_file-1' } },
      ),
    ).toThrow(/no files expression to fetch/);
  });

  it('refuses file_fetch_input when the app names no fetch node', () => {
    expect(() =>
      load({
        record: {
          ...valid_object,
          files: { $: 'item.files' },
          file_fetch_input: { id: { $: 'item.id' } },
        },
      }),
    ).toThrow(/names no node to feed it to/);
  });

  it('refuses a text resolver pattern with no capture group', () => {
    expect(() =>
      load({
        record: { ...valid_object, text_resolvers: [{ pattern: 'no group', render: 'x' }] },
      }),
    ).toThrow(/no capture group/);
  });

  it('refuses a text resolver render naming a group the pattern never captures', () => {
    expect(() =>
      load({
        record: {
          ...valid_object,
          text_resolvers: [{ pattern: '<@(\\w+)>', render: '{1} and {3}' }],
        },
      }),
    ).toThrow(/pattern captures 1/);
  });

  it('refuses a person lookup resolver when the app declares no directory', () => {
    expect(() =>
      load({
        record: {
          ...valid_object,
          text_resolvers: [{ pattern: '<@(\\w+)>', lookup: 'person', render: '@{display_name}' }],
        },
      }),
    ).toThrow(/declares no sync directory/);
  });

  it('refuses line on an object with no bucket', () => {
    expect(() =>
      load({ record: { ...valid_object, line: { author: { $: 'item.author' } } } }),
    ).toThrow(/only a bucketed object renders/);
  });

  it('refuses line.text when content is not a read_node', () => {
    expect(() =>
      load({
        record: {
          ...valid_object,
          bucket: { by: 'key', key: { $: 'item.key' } },
          line: { author: { $: 'item.author' }, text: { $: 'item.text' } },
        },
      }),
    ).toThrow(/only read_node content evaluates/);
  });

  it('refuses a scope_day_of relationship mixed with another key', () => {
    expect(() =>
      load({
        record: {
          ...valid_object,
          relationships: { thread: { scope_day_of: { $: 'item.day' }, extra: 1 } },
        },
      }),
    ).toThrow(/mixes scope_day_of with other keys/);
  });

  it('loads assignee, reporter and attendee relationship keys', () => {
    const app = load({
      record: {
        ...valid_object,
        relationships: {
          assignee: { $: 'item.assignee_id' },
          reporter: { $: 'item.reporter_id' },
          attendee: { $: 'item.attendee_id' },
        },
      },
    });
    expect(app.sync?.objects?.record?.relationships).toEqual({
      assignee: { $: 'item.assignee_id' },
      reporter: { $: 'item.reporter_id' },
      attendee: { $: 'item.attendee_id' },
    });
  });

  it('refuses a relationship key that is not a valid relation name', () => {
    expect(() =>
      load({
        record: { ...valid_object, relationships: { Assignee: { $: 'item.assignee_id' } } },
      }),
    ).toThrow(/relationship key 'Assignee' must match \^\[a-z\]\[a-z0-9_\]\{1,40\}\$/);
  });

  it('refuses a browse_request that reads a field the picker never offers', () => {
    expect(() => load({}, {}, { browse_request: { q: { $: 'item.query' } } })).toThrow(
      /not a picker field/,
    );
  });

  it('refuses selection_includes_descendants on a flat dimension', () => {
    expect(() => load({}, {}, { selection_includes_descendants: true })).toThrow(
      /only a tree dimension has a subtree/,
    );
  });

  it('refuses a file_fetch.hosts entry that is not a `*.` wildcard', () => {
    expect(() => load({}, { file_fetch: { hosts: ['*slack.com'] } })).toThrow(
      /app\.json is invalid/,
    );
  });

  it('refuses a directory with no identity or display_name', () => {
    expect(() =>
      load(
        {},
        {
          directory: { list_node: 'demo-list_records-1', page: { items: { $: 'response.items' } } },
        },
      ),
    ).toThrow(/app\.json is invalid/);
  });
});

describe('the recipes the shipped apps declare', () => {
  it('reads Slack as two documents off one list node: the day, and the thread', () => {
    const day = get_sync_objects('slack').channel_day;
    const thread = get_sync_objects('slack').thread;
    expect(day).toMatchObject({
      list_node: 'slack-list_messages-1',
      strategy: 'append_log',
      edit_window_days: 14,
      bucket: { by: 'key' },
      item_kind: 'slack_channel_day',
    });
    expect(thread).toMatchObject({
      list_node: 'slack-list_messages-1',
      bucket: { by: 'key' },
      item_kind: 'slack_thread',
    });
    expect(slack_app.sync.objects.channel_day.scoped_by.channels).toBe('channels[].channel_id');
    expect(day?.when).toEqual({ $: 'item.is_day_record' });
    expect(thread?.when).toEqual({ $: 'item.is_thread_record' });
    expect(day?.content).toEqual({ $: 'item.line' });
    expect(thread?.relationships).toEqual({ in_container: { $: 'item.day_document_key' } });
    expect(day?.files).toEqual({ $: 'item.files' });
  });

  it('reads Gmail under either dimension a person can pick', () => {
    const recipe = get_sync_objects('gmail').message;
    expect(recipe?.scoped_by).toEqual({ labels: 'label_ids[]', search: 'query' });
    expect(recipe?.strategy).toBe('relist_diff');
    expect(gmail_app.sync.objects.message.note).toContain('history change feed');
  });

  it('reads GitHub issues with the provider`s own since filter', () => {
    const recipe = get_sync_objects('github').issue;
    expect(recipe).toMatchObject({ strategy: 'modified_since', cursor: { param: 'since' } });
    const node = get_connector_node('github-list_issues-1');
    const input_schema = node?.node.input_schema as { properties: Record<string, unknown> };
    expect(input_schema.properties.since).toBeDefined();
    expect(github_app.sync.objects.pull_request.strategy).toBe('relist_diff');
  });

  it('sends every scope into an input its list node declares', () => {
    for (const app_key of ['slack', 'gmail', 'github', 'notion', 'hubspot', 'attio']) {
      for (const [object_key, recipe] of Object.entries(get_sync_objects(app_key))) {
        const node = get_connector_node(recipe.list_node);
        expect(node, `${app_key}.${object_key} names ${recipe.list_node}`).not.toBeNull();
        const properties = (node?.node.input_schema as { properties: Record<string, unknown> })
          .properties;
        for (const path of Object.values(recipe.scoped_by)) {
          if (path === null) continue;
          const field = path.split('.')[0]?.replace('[]', '') as string;
          expect(properties[field], `${app_key}.${object_key} writes ${path}`).toBeDefined();
        }
        const cursor_field = recipe.cursor?.param.split('.')[0]?.replace('[]', '');
        if (cursor_field) {
          expect(properties[cursor_field], `${app_key}.${object_key} cursor`).toBeDefined();
        }
      }
    }
  });
});
