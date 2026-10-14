import {
  notion_json_response,
  notion_test_connection,
  run_notion_node,
  stub_notion_fetch,
} from '@connectors/apps/notion/notion_test_context';
import * as execute_module from '@connectors/apps/notion/search_pages/v1/execute';
import fixtures from '@connectors/apps/notion/search_pages/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/notion/search_pages/v1/node.json' with { type: 'json' };
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { browse_scope_options, find_sync_dimension } from '@connectors/sync_scope';
import type { JsonSchema } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = execute_module;

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notion-search_pages-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    const loaded = load_connector_node(
      'apps/notion/search_pages/v1/node.json',
      definition,
      execute_module,
    );
    expect(loaded.node_key).toBe('notion-search_pages-1');
    expect(loaded.execute).toBe(execute);
  });

  it('declares the key its folder proves, and the code that carries the work', () => {
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toEqual([]);
    expect(definition.quirks.endpoint).toBe('POST /v1/search');
  });

  it('is written as JSON Schema, plural on the way out', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.response_schemas.search.$schema).toBe(draft);
    expect(definition.output_schema.properties.results.type).toBe('array');
    expect(definition.output_schema.required).toContain('next_cursor');
    expect(definition.input_schema.properties.filter_object_type.enum).toEqual([
      'page',
      'data_source',
    ]);
  });

  it('accepts every recorded Notion answer against its own schema', () => {
    const schema = definition.response_schemas.search as JsonSchema;
    for (const [name, page] of Object.entries(fixtures)) {
      expect([name, find_json_schema_violation(schema, page, 'response')]).toEqual([name, null]);
    }
  });
});

describe('notion-search_pages-1', () => {
  it('reads a title from a page property and from a data source alike', async () => {
    const calls = stub_notion_fetch(() => notion_json_response(fixtures.search_page_one));

    const output = await run_notion_node(definition, execute, {
      query: 'bug',
      filter_object_type: 'page',
      cursor: 'cur_01',
      limit: 50,
    });

    expect(output).toEqual({
      results: [
        {
          id: 'be633bf1-dfa0-436d-b259-571129a590e5',
          object: 'page',
          title: 'Bug bash',
          url: 'https://www.notion.so/Bug-bash-be633bf1dfa0436db259571129a590e5',
          last_edited_time: '2023-03-08T18:25:00.000Z',
        },
        {
          id: 'd9824bdc-8445-4327-be8b-5b47500af6ce',
          object: 'data_source',
          title: 'Engineering tasks',
          url: 'https://www.notion.so/d9824bdc84454327be8b5b47500af6ce',
          last_edited_time: '2023-03-08T18:20:00.000Z',
        },
      ],
      next_cursor: 'c02fc1d3-db8b-45c5-a222-27595b15aea7',
      has_more: true,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(new URL(call?.url ?? '').pathname).toBe('/v1/search');
    expect(call?.method).toBe('POST');
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      query: 'bug',
      filter: { property: 'object', value: 'page' },
      start_cursor: 'cur_01',
      page_size: 50,
    });
    expect(call?.headers.Authorization).toBe('Bearer token_notion');
    expect(call?.headers['Notion-Version']).toBe('2026-03-11');
  });

  it('sends no filter and no cursor when the caller gave none', async () => {
    const calls = stub_notion_fetch(() => notion_json_response(fixtures.search_last_page));

    const output = await run_notion_node(definition, execute, {});

    expect(JSON.parse(calls[0]?.body ?? 'null')).toEqual({});
    expect(output).toEqual({
      results: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          object: 'page',
          title: 'Sample Page Title',
          url: 'https://www.notion.so/Sample-Page-Title-550e8400e29b41d4a716446655440000',
          last_edited_time: '2024-01-20T14:45:00.000Z',
        },
      ],
      next_cursor: null,
      has_more: false,
    });
  });

  it('rejects a filter Notion no longer accepts before any request', async () => {
    const calls = stub_notion_fetch(() => notion_json_response(fixtures.search_last_page));

    await expect(
      run_notion_node(definition, execute, { filter_object_type: 'database' }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('notion data sources sync dimension', () => {
  it('browses the data sources a person picks from through this node', async () => {
    const calls = stub_notion_fetch(() => notion_json_response(fixtures.search_page_one));
    const dimension = find_sync_dimension('notion');

    const result = await browse_scope_options(
      'notion-search_pages-1',
      { query: 'eng' },
      notion_test_connection,
      dimension ?? { key: 'data_sources', label: 'Databases', shape: 'flat', browse_node: '' },
    );

    expect(dimension).toMatchObject({
      key: 'data_sources',
      shape: 'flat',
      browse_node: 'notion-search_pages-1',
      browse_input: { filter_object_type: 'data_source' },
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      query: 'eng',
      filter: { property: 'object', value: 'data_source' },
    });
    expect(result).toEqual({
      ok: true,
      data: {
        options: [
          {
            id: 'be633bf1-dfa0-436d-b259-571129a590e5',
            label: 'Bug bash',
            kind: 'data_source',
            selectable: true,
          },
          {
            id: 'd9824bdc-8445-4327-be8b-5b47500af6ce',
            label: 'Engineering tasks',
            kind: 'data_source',
            selectable: true,
          },
        ],
        next_cursor: 'c02fc1d3-db8b-45c5-a222-27595b15aea7',
      },
    });
  });
});
