import { load_connector_app } from '@connectors/load_definition';
import { build_connector_registry } from '@connectors/registry';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import {
  browse_scope_options,
  find_sync_dimension,
  get_sync_dimensions,
} from '@connectors/sync_scope';
import type { ConnectorSyncDimension } from '@connectors/sync_types';
import type { ConnectorConnection } from '@connectors/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connection: ConnectorConnection = {
  connection_id: 'conn_picker',
  access_token: 'token_abc',
};

function json_response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stub_fetch(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return json_response(body);
    }),
  );
  return calls;
}

function list_items_node_module() {
  return {
    source_path: 'apps/example_sync/list_items/v1/node.json',
    definition: {
      node_key: 'example_sync-list_items-1',
      description: 'Lists items, one page at a time.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: { cursor: { type: 'string' }, limit: { type: 'integer' } },
      },
      output_schema: { type: 'object' },
      http: {
        method: 'GET',
        path: '/items',
        response_schema: { type: 'object' },
      },
    },
  };
}

function example_app_definition(sync: unknown) {
  return {
    app_key: 'example_sync',
    display_name: 'Example sync',
    base_url: 'https://example.invalid/api',
    rate_limits: { rpm: 600, concurrency: 2, burst: 2 },
    auth: { kind: 'none' },
    sync,
  };
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sync declaration', () => {
  it('reads the example app dimensions off the registry', () => {
    expect(get_sync_dimensions('example')).toEqual([
      expect.objectContaining({
        key: 'items',
        label: 'Items',
        shape: 'flat',
        browse_node: 'example-echo_items-1',
        allow_select_all: true,
      }),
    ]);
  });

  it('answers with the first dimension when a request names none', () => {
    expect(find_sync_dimension('example')?.key).toBe('items');
    expect(find_sync_dimension('example', 'items')?.key).toBe('items');
    expect(find_sync_dimension('example', 'nothing')).toBeNull();
    expect(find_sync_dimension('nothing')).toBeNull();
  });

  it('refuses a dimension whose shape is not one the picker draws', () => {
    expect(() =>
      load_connector_app(
        'apps/example_sync/app.json',
        example_app_definition({
          dimensions: [
            {
              key: 'items',
              label: 'Items',
              shape: 'carousel',
              browse_node: 'example-echo_items-1',
            },
          ],
        }),
      ),
    ).toThrow(/app\.json is invalid/u);
  });

  it('takes a query dimension with no browse node, because the text is the whole scope', () => {
    const app = load_connector_app(
      'apps/example_sync/app.json',
      example_app_definition({
        dimensions: [{ key: 'search', label: 'Search', shape: 'query', placeholder: 'from:acme' }],
      }),
    );

    expect(app.sync?.dimensions[0]?.browse_node).toBeUndefined();
  });

  it('still needs a browse node for a shape that draws a list', () => {
    expect(() =>
      load_connector_app(
        'apps/example_sync/app.json',
        example_app_definition({ dimensions: [{ key: 'items', label: 'Items', shape: 'flat' }] }),
      ),
    ).toThrow(/app\.json is invalid/u);
  });

  it('refuses a misspelled dimension key, which is a typo rather than a quirk', () => {
    expect(() =>
      load_connector_app(
        'apps/example_sync/app.json',
        example_app_definition({
          dimensions: [
            {
              key: 'items',
              label: 'Items',
              shape: 'flat',
              brows_node: 'example-echo_items-1',
              browse_node: 'example-echo_items-1',
            },
          ],
        }),
      ),
    ).toThrow(/app\.json is invalid/u);
  });

  it('takes a search_param, which is how the typed text reaches the browse node', () => {
    const app = load_connector_app(
      'apps/example_sync/app.json',
      example_app_definition({
        dimensions: [
          {
            key: 'items',
            label: 'Items',
            shape: 'flat',
            browse_node: 'example-echo_items-1',
            search_param: 'query',
          },
        ],
      }),
    );

    expect(app.sync?.dimensions[0]?.search_param).toBe('query');
  });

  it('refuses a search_param that is not an input field name', () => {
    expect(() =>
      load_connector_app(
        'apps/example_sync/app.json',
        example_app_definition({
          dimensions: [
            {
              key: 'items',
              label: 'Items',
              shape: 'flat',
              browse_node: 'example-echo_items-1',
              search_param: 'Query Text',
            },
          ],
        }),
      ),
    ).toThrow(/app\.json is invalid/u);
  });

  it('refuses a search_param the browse node does not take', () => {
    expect(() =>
      build_connector_registry(
        [
          {
            source_path: 'apps/example_sync/app.json',
            definition: example_app_definition({
              dimensions: [
                {
                  key: 'items',
                  label: 'Items',
                  shape: 'flat',
                  browse_node: 'example_sync-list_items-1',
                  search_param: 'search_text',
                },
              ],
            }),
          },
        ],
        [list_items_node_module()],
      ),
    ).toThrow(/does not take as an input/u);
  });

  it('refuses an option_mapping that is not a legal value expression', () => {
    expect(() =>
      load_connector_app(
        'apps/example_sync/app.json',
        example_app_definition({
          dimensions: [
            {
              key: 'items',
              label: 'Items',
              shape: 'flat',
              browse_node: 'example-echo_items-1',
              option_mapping: { id: { $mpa: 'item.id' } },
            },
          ],
        }),
      ),
    ).toThrow(/malformed option_mapping/u);
  });

  it('refuses a browse node that no app registers', () => {
    expect(() =>
      build_connector_registry(
        [
          {
            source_path: 'apps/example_sync/app.json',
            definition: example_app_definition({
              dimensions: [
                {
                  key: 'items',
                  label: 'Items',
                  shape: 'flat',
                  browse_node: 'example_sync-list_nothing-1',
                },
              ],
            }),
          },
        ],
        [],
      ),
    ).toThrow(/not a registered node/u);
  });
});

function browse_node_of(dimension: ConnectorSyncDimension) {
  if (!dimension.browse_node) throw new Error(`the ${dimension.key} test dimension needs a node`);
  return dimension.browse_node;
}

describe('browse_scope_options', () => {
  const dimension = find_sync_dimension('example') as ConnectorSyncDimension;

  it('runs an ordinary list node and maps its items into scope options', async () => {
    const calls = stub_fetch({
      echoed: [
        { id: 'itm_01', value: 'Courses' },
        { id: 'itm_02', value: 'Faculty' },
      ],
      next_cursor: 'cur_02',
    });

    const result = await browse_scope_options(
      browse_node_of(dimension),
      { cursor: 'cur_01' },
      connection,
      dimension,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        options: [
          { id: 'itm_01', label: 'Courses', kind: 'document' },
          { id: 'itm_02', label: 'Faculty', kind: 'document' },
        ],
        next_cursor: 'cur_02',
      },
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ items: ['first', 'second'] });
    expect(calls[0]?.url).toContain('cursor=cur_01');
  });

  it('passes a node that already answers in the option shape straight through', async () => {
    stub_fetch({
      echoed: [{ id: 'itm_01', value: 'Courses' }],
      next_cursor: null,
    });
    const plain: ConnectorSyncDimension = {
      key: 'items',
      label: 'Items',
      shape: 'flat',
      browse_node: 'example-echo_items-1',
      browse_input: { items: ['first'] },
    };

    const result = await browse_scope_options(browse_node_of(plain), {}, connection, plain);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_output', message: expect.stringContaining('scope-option shape') },
    });
  });

  it('takes a number as a sublabel, because the operators cannot format a count', async () => {
    stub_fetch({ echoed: [{ id: 'itm_01', value: 'Courses' }], next_cursor: null });
    const with_count: ConnectorSyncDimension = {
      key: 'items',
      label: 'Items',
      shape: 'flat',
      browse_node: 'example-echo_items-1',
      browse_input: { items: ['first'] },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $: 'item.text' },
        sublabel: { $literal: 42 },
      },
    };

    const result = await browse_scope_options(
      browse_node_of(with_count),
      {},
      connection,
      with_count,
    );

    expect(result).toMatchObject({ ok: true, data: { options: [{ sublabel: 42 }] } });
  });

  it('never sends the typed text to a dimension that cannot search, and narrows by label instead', async () => {
    const calls = stub_fetch({
      echoed: [
        { id: 'itm_01', value: 'Support' },
        { id: 'itm_02', value: 'Faculty' },
      ],
      next_cursor: null,
    });

    const result = await browse_scope_options(
      browse_node_of(dimension),
      { query: 'sup' },
      connection,
      dimension,
    );

    expect(result).toEqual({
      ok: true,
      data: { options: [{ id: 'itm_01', label: 'Support', kind: 'document' }], next_cursor: null },
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ items: ['first', 'second'] });
    expect(calls[0]?.url).not.toContain('sup');
  });

  it('sends the typed text under the name the dimension declares, and narrows nothing itself', async () => {
    const calls = stub_fetch({
      echoed: [
        { id: 'itm_01', value: 'Support' },
        { id: 'itm_02', value: 'Faculty' },
      ],
      next_cursor: null,
    });
    const searchable: ConnectorSyncDimension = { ...dimension, search_param: 'cursor' };

    const result = await browse_scope_options(
      browse_node_of(searchable),
      { query: 'sup' },
      connection,
      searchable,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { options: [{ label: 'Support' }, { label: 'Faculty' }] },
    });
    expect(calls[0]?.url).toContain('cursor=sup');
  });

  it('hands a provider failure back as the door owns it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    );

    const result = await browse_scope_options(browse_node_of(dimension), {}, connection, dimension);

    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('reads the named array when the node answers with more than one', async () => {
    stub_fetch({ id: 'itm_01', value: 'Courses' });
    const many_arrays: ConnectorSyncDimension = {
      key: 'items',
      label: 'Items',
      shape: 'flat',
      browse_node: 'example-collect_items-1',
      browse_input: { item_ids: ['itm_01'] },
      option_mapping: { id: { $: 'item.id' }, label: { $: 'item.text' } },
    };

    const result = await browse_scope_options(
      browse_node_of(many_arrays),
      {},
      connection,
      many_arrays,
    );

    expect(result).toEqual({
      ok: true,
      data: { options: [{ id: 'itm_01', label: 'Courses' }], next_cursor: null },
    });
  });
});

describe('browse_scope_options with a browse_request', () => {
  const templated: ConnectorSyncDimension = {
    key: 'items',
    label: 'Items',
    shape: 'tree',
    browse_node: 'example-echo_items-1',
    browse_input: { items: ['first'] },
    browse_request: {
      cursor: {
        $default: ['{parent_id}-{query}', '{parent_id}', 'root'],
      },
    },
  };

  it('shapes the node input from the request, never forwarding the raw picker fields', async () => {
    const calls = stub_fetch({ echoed: [], next_cursor: null });

    const result = await browse_scope_options(
      browse_node_of(templated),
      { parent_id: 'folder_1', query: 'roadmap' },
      connection,
      templated,
    );

    expect(result).toMatchObject({ ok: true });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ items: ['first'] });
    expect(calls[0]?.url).toContain('cursor=folder_1-roadmap');
  });

  it('falls back through the $default chain when a level has nothing set', async () => {
    const calls = stub_fetch({ echoed: [], next_cursor: null });

    const result = await browse_scope_options(browse_node_of(templated), {}, connection, templated);

    expect(result).toMatchObject({ ok: true });
    expect(calls[0]?.url).toContain('cursor=root');
  });

  it('lets search_param still reach the node under its own name next to a browse_request, with no raw parent_id or query leaking', async () => {
    const searchable_templated: ConnectorSyncDimension = {
      key: 'items',
      label: 'Items',
      shape: 'tree',
      browse_node: 'example-echo_items-1',
      search_param: 'cursor',
      browse_request: { items: ['{parent_id}'] },
    };
    const calls = stub_fetch({ echoed: [], next_cursor: null });

    const result = await browse_scope_options(
      browse_node_of(searchable_templated),
      { parent_id: 'folder_1', query: 'roadmap' },
      connection,
      searchable_templated,
    );

    expect(result).toMatchObject({ ok: true });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ items: ['folder_1'] });
    expect(calls[0]?.url).toContain('cursor=roadmap');
    expect(calls[0]?.url).not.toContain('parent_id');
    expect(calls[0]?.url).not.toContain('query=');
  });
});
