import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connector_app_modules, connector_node_modules } from '@connectors/apps/index';
import { build_apps_index_source, connector_apps_index_path } from '@connectors/build_apps_index';
import {
  build_connector_registry,
  get_all_connector_nodes,
  get_connector_app,
  get_connector_node,
  is_connector_app_held,
  read_connector_app_hold,
} from '@connectors/registry';
import { describe, expect, it } from 'vitest';

const package_directory = resolve(import.meta.dirname, '../..');

const test_app = {
  app_key: 'demo',
  display_name: 'Demo',
  base_url: 'https://demo.invalid',
  rate_limits: { rpm: 60, concurrency: 1, burst: 1 },
  auth: { kind: 'none' },
};

function build_test_node(node_key: string) {
  return {
    node_key,
    description: 'List demo records.',
    implementation: 'execute',
    input_schema: {
      type: 'object',
      properties: { filters: { type: 'array', items: { type: 'string' } } },
      required: ['filters'],
    },
    output_schema: {
      type: 'object',
      properties: { records: { type: 'array', items: { type: 'string' } } },
      required: ['records'],
    },
  };
}

const test_execute_module = { execute: async () => ({ records: [] }) };

describe('build_connector_registry', () => {
  it('registers a node whose path proves its node_key', () => {
    const registry = build_connector_registry(
      [{ source_path: 'apps/demo/app.json', definition: test_app }],
      [
        {
          source_path: 'apps/demo/list_records/v1/node.json',
          definition: build_test_node('demo-list_records-1'),
          execute_module: test_execute_module,
        },
      ],
    );

    const registered = registry.nodes.get('demo-list_records-1');
    expect(registered?.app_key).toBe('demo');
    expect(registered?.node_name).toBe('list_records');
    expect(registered?.node_version).toBe(1);
    expect(registered?.node.execute).toBe(test_execute_module.execute);
  });

  it('rejects a node whose folder disagrees with its node_key', () => {
    expect(() =>
      build_connector_registry(
        [{ source_path: 'apps/demo/app.json', definition: test_app }],
        [
          {
            source_path: 'apps/demo/list_records/v2/node.json',
            definition: build_test_node('demo-list_records-1'),
            execute_module: test_execute_module,
          },
        ],
      ),
    ).toThrow('path and node_key disagree');
  });

  it('rejects a path that is not apps/{app}/{node}/v{n}/node.json', () => {
    expect(() =>
      build_connector_registry(
        [{ source_path: 'apps/demo/app.json', definition: test_app }],
        [
          {
            source_path: 'apps/demo/list_records/node.json',
            definition: build_test_node('demo-list_records-1'),
            execute_module: test_execute_module,
          },
        ],
      ),
    ).toThrow('apps/{app}/{node}/v{n}/node.json');
  });

  it('rejects a node whose app has no app.json', () => {
    expect(() =>
      build_connector_registry(
        [],
        [
          {
            source_path: 'apps/demo/list_records/v1/node.json',
            definition: build_test_node('demo-list_records-1'),
            execute_module: test_execute_module,
          },
        ],
      ),
    ).toThrow('has no app.json');
  });

  it('rejects two nodes claiming the same node_key', () => {
    const module = {
      source_path: 'apps/demo/list_records/v1/node.json',
      definition: build_test_node('demo-list_records-1'),
      execute_module: test_execute_module,
    };
    expect(() =>
      build_connector_registry(
        [{ source_path: 'apps/demo/app.json', definition: test_app }],
        [module, module],
      ),
    ).toThrow('Duplicate connector node_key');
  });

  it('rejects two app.json files claiming the same app_key', () => {
    expect(() =>
      build_connector_registry(
        [
          { source_path: 'apps/demo/app.json', definition: test_app },
          { source_path: 'apps/demo/app.json', definition: test_app },
        ],
        [],
      ),
    ).toThrow('Duplicate connector app');
  });

  it('rejects an app.json whose folder disagrees with its app_key', () => {
    expect(() =>
      build_connector_registry([{ source_path: 'apps/other/app.json', definition: test_app }], []),
    ).toThrow('path and app_key disagree');
  });

  it('rejects a people directory that crawls through an unregistered node', () => {
    expect(() =>
      build_connector_registry(
        [
          {
            source_path: 'apps/demo/app.json',
            definition: {
              ...test_app,
              sync: {
                dimensions: [{ key: 'search', label: 'Search', shape: 'query' }],
                directory: {
                  list_node: 'demo-list_people-1',
                  page: { items: { $: 'response.people' } },
                  identity: { $: 'item.id' },
                  display_name: { $: 'item.name' },
                },
              },
            },
          },
        ],
        [],
      ),
    ).toThrow('not a registered node');
  });
});

describe('the node.json loader', () => {
  function register_one(definition: unknown, execute_module?: unknown) {
    return build_connector_registry(
      [{ source_path: 'apps/demo/app.json', definition: test_app }],
      [
        {
          source_path: 'apps/demo/list_records/v1/node.json',
          definition,
          ...(execute_module === undefined ? {} : { execute_module }),
        },
      ],
    );
  }

  it('refuses a node.json that is missing a required key', () => {
    const { description: _description, ...without_description } =
      build_test_node('demo-list_records-1');
    expect(() => register_one(without_description, test_execute_module)).toThrow(
      'node.json is invalid',
    );
  });

  it('refuses an unknown key inside the http mapping, where a key is a typo not a quirk', () => {
    expect(() =>
      register_one({
        ...build_test_node('demo-list_records-1'),
        implementation: 'http',
        http: {
          method: 'GET',
          path: '/records',
          response_schema: { type: 'object' },
          paginat: { cursor_query_parameter: 'cursor' },
        },
      }),
    ).toThrow('node.json is invalid');
  });

  it('keeps an unknown top-level quirk key', () => {
    const registry = register_one(
      { ...build_test_node('demo-list_records-1'), requests: ['GET /records'] },
      test_execute_module,
    );
    const registered = registry.nodes.get('demo-list_records-1');
    expect((registered?.node as { requests?: string[] }).requests).toEqual(['GET /records']);
  });

  it('refuses a node with neither an http mapping nor an execute.ts', () => {
    expect(() => register_one(build_test_node('demo-list_records-1'))).toThrow(
      'neither an http mapping nor an execute.ts',
    );
  });

  it('refuses a node that declares both halves', () => {
    expect(() =>
      register_one(
        {
          ...build_test_node('demo-list_records-1'),
          implementation: 'http',
          http: { method: 'GET', path: '/records', response_schema: { type: 'object' } },
        },
        test_execute_module,
      ),
    ).toThrow('its folder has an execute.ts');
  });

  it('refuses an execute.ts that exports no execute function', () => {
    expect(() => register_one(build_test_node('demo-list_records-1'), { helper: 1 })).toThrow(
      'must export an execute function',
    );
  });

  it('takes execute from a default export as readily as a named one', () => {
    const default_export = async () => ({ records: [] });
    const registry = register_one(build_test_node('demo-list_records-1'), {
      default: default_export,
    });
    expect(registry.nodes.get('demo-list_records-1')?.node.execute).toBe(default_export);
  });

  it('refuses a broken JSON Schema at load, not at the first request', () => {
    expect(() =>
      register_one(
        {
          ...build_test_node('demo-list_records-1'),
          input_schema: { type: 'not_a_json_schema_type' },
        },
        test_execute_module,
      ),
    ).toThrow('is not a valid JSON Schema');
  });

  it('loads an app that is held, and keeps the reason a person reads', () => {
    const registry = build_connector_registry(
      [
        {
          source_path: 'apps/demo/app.json',
          definition: {
            ...test_app,
            availability: { status: 'held', reason: 'Nobody approved the scopes yet.' },
          },
        },
      ],
      [],
    );
    expect(registry.apps.get('demo')?.availability).toEqual({
      status: 'held',
      reason: 'Nobody approved the scopes yet.',
    });
  });

  it('refuses an availability status that is not held', () => {
    expect(() =>
      build_connector_registry(
        [
          {
            source_path: 'apps/demo/app.json',
            definition: { ...test_app, availability: { status: 'available', reason: 'Ready.' } },
          },
        ],
        [],
      ),
    ).toThrow('app.json is invalid');
  });

  it('refuses a hold with no reason to show', () => {
    expect(() =>
      build_connector_registry(
        [
          {
            source_path: 'apps/demo/app.json',
            definition: { ...test_app, availability: { status: 'held', reason: '  ' } },
          },
        ],
        [],
      ),
    ).toThrow('app.json is invalid');
  });

  it('refuses an app.json with an auth kind nobody implements', () => {
    expect(() =>
      build_connector_registry(
        [
          {
            source_path: 'apps/demo/app.json',
            definition: { ...test_app, auth: { kind: 'basic_auth' } },
          },
        ],
        [],
      ),
    ).toThrow('app.json is invalid');
  });
});

describe('the checked-in registry', () => {
  it('exposes the example node by key and its app', () => {
    expect(get_connector_node('example-echo_items-1')?.node_name).toBe('echo_items');
    expect(get_connector_app('example')?.base_url).toBe('https://example.invalid/api');
    expect(get_connector_app('missing_app')).toBeNull();
    expect(get_connector_node('example-echo_items-9')).toBeNull();
    expect(get_all_connector_nodes().map((node) => node.node_key)).toContain(
      'example-echo_items-1',
    );
  });

  it('holds Gmail and Google Drive until Google approves their scopes', () => {
    expect(read_connector_app_hold('gmail')?.reason).toBe(
      "Google has not approved this app's scopes yet.",
    );
    expect(is_connector_app_held('google_drive')).toBe(true);
    expect(is_connector_app_held('example')).toBe(false);
    expect(read_connector_app_hold('example')).toBeNull();
  });

  it('matches what is on disk', async () => {
    const generated = await build_apps_index_source(package_directory);
    const checked_in = await readFile(join(package_directory, connector_apps_index_path), 'utf8');
    expect(checked_in).toBe(generated);
  });

  it('carries every folder on disk into the module lists', async () => {
    const generated = await build_apps_index_source(package_directory);
    for (const module of [...connector_app_modules, ...connector_node_modules]) {
      expect(generated).toContain(module.source_path);
    }
  });
});
