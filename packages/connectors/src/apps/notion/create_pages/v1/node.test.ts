import * as execute_module from '@connectors/apps/notion/create_pages/v1/execute';
import fixtures from '@connectors/apps/notion/create_pages/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/notion/create_pages/v1/node.json' with { type: 'json' };
import {
  notion_json_response,
  run_notion_node,
  stub_notion_fetch,
} from '@connectors/apps/notion/notion_test_context';
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { JsonSchema } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = execute_module;

const tasks_data_source = 'd9824bdc-8445-4327-be8b-5b47500af6ce';
const tasks_database = '8e2c2b76-9e1d-47d2-87b9-ed3035d607ae';
const parent_page = '987f6543-d21c-87a9-b123-987654321abc';

function title_property(text: string) {
  return { 'Task name': { title: [{ text: { content: text } }] } };
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notion-create_pages-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    const loaded = load_connector_node(
      'apps/notion/create_pages/v1/node.json',
      definition,
      execute_module,
    );
    expect(loaded.node_key).toBe('notion-create_pages-1');
    expect(loaded.execute).toBe(execute);
  });

  it('declares the key its folder proves, and the code that carries the work', () => {
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toEqual([]);
    expect(definition.atomic).toBe(false);
    expect(definition.quirks.not_atomic).toContain('four created pages and one clear error');
  });

  it('is written as JSON Schema, plural on both sides', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.response_schemas.created_page.$schema).toBe(draft);
    expect(definition.input_schema.properties.pages.type).toBe('array');
    expect(definition.input_schema.required).toEqual(['pages']);
    expect(definition.output_schema.properties.results.items.required).toContain('error');
  });

  it('accepts every recorded Notion answer against its own schema', () => {
    const page_schema = definition.response_schemas.created_page as JsonSchema;
    const database_schema = definition.response_schemas.database as JsonSchema;
    for (const page of [fixtures.created_row, fixtures.created_child_page]) {
      expect(find_json_schema_violation(page_schema, page, 'response')).toBeNull();
    }
    expect(
      find_json_schema_violation(database_schema, fixtures.database_with_one_data_source, 'db'),
    ).toBeNull();
  });
});

describe('notion-create_pages-1', () => {
  it('creates a table row and a nested page in one call', async () => {
    const calls = stub_notion_fetch((request) =>
      notion_json_response(
        JSON.parse(request.body ?? '{}').parent?.type === 'page_id'
          ? fixtures.created_child_page
          : fixtures.created_row,
      ),
    );

    const output = await run_notion_node(definition, execute, {
      pages: [
        {
          parent: { data_source_id: tasks_data_source },
          properties: title_property('Bug bash'),
          children_markdown:
            '# Bug bash\n\n## Agenda\n\n### Owners\n\n- Triage P0s\n* Close the stale ones\n\nEveryone joins at 10.',
        },
        { parent: { page_id: parent_page }, properties: title_property('Weekly notes') },
      ],
    });

    expect(output).toEqual({
      results: [
        {
          index: 0,
          ok: true,
          page_id: '397d9d71-e5b8-813f-b041-d7bf6a67ed23',
          title: 'Bug bash',
          url: 'https://www.notion.so/Bug-bash-397d9d71e5b8813fb041d7bf6a67ed23',
          error: null,
        },
        {
          index: 1,
          ok: true,
          page_id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Weekly notes',
          url: 'https://www.notion.so/Weekly-notes-123e4567e89b12d3a456426614174000',
          error: null,
        },
      ],
    });

    expect(calls).toHaveLength(2);
    const row_call = calls.find((call) => call.body?.includes('data_source_id'));
    expect(new URL(row_call?.url ?? '').pathname).toBe('/v1/pages');
    expect(row_call?.headers['Notion-Version']).toBe('2026-03-11');
    expect(JSON.parse(row_call?.body ?? '{}').parent).toEqual({
      type: 'data_source_id',
      data_source_id: tasks_data_source,
    });
    expect(JSON.parse(row_call?.body ?? '{}').children).toEqual([
      {
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: 'Bug bash' } }] },
      },
      {
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Agenda' } }] },
      },
      {
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: 'Owners' } }] },
      },
      {
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'Triage P0s' } }] },
      },
      {
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: 'Close the stale ones' } }],
        },
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: 'Everyone joins at 10.' } }] },
      },
    ]);
  });

  it('leaves inline markdown as literal text and splits a line Notion would reject', async () => {
    const calls = stub_notion_fetch(() => notion_json_response(fixtures.created_row));

    await run_notion_node(definition, execute, {
      pages: [
        {
          parent: { data_source_id: tasks_data_source },
          properties: title_property('Long'),
          children_markdown: `**bold** and [a link](https://example.com)\n${'a'.repeat(2500)}`,
        },
      ],
    });

    const children = JSON.parse(calls[0]?.body ?? '{}').children;
    expect(children[0].paragraph.rich_text).toEqual([
      { type: 'text', text: { content: '**bold** and [a link](https://example.com)' } },
    ]);
    expect(children[1].paragraph.rich_text).toHaveLength(2);
    expect(children[1].paragraph.rich_text[0].text.content).toHaveLength(2000);
    expect(children[1].paragraph.rich_text[1].text.content).toHaveLength(500);
  });

  it('resolves a database parent to its data source before writing', async () => {
    const calls = stub_notion_fetch((request) =>
      request.url.includes('/databases/')
        ? notion_json_response(fixtures.database_with_one_data_source)
        : notion_json_response(fixtures.created_row),
    );

    await run_notion_node(definition, execute, {
      pages: [{ parent: { database_id: tasks_database }, properties: title_property('Bug bash') }],
    });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/v1/databases/${tasks_database}`);
    expect(JSON.parse(calls[1]?.body ?? '{}').parent).toEqual({
      type: 'data_source_id',
      data_source_id: tasks_data_source,
    });
  });

  it('refuses markdown Notion cannot hold, and creates the other page anyway', async () => {
    const calls = stub_notion_fetch(() => notion_json_response(fixtures.created_row));

    const output = await run_notion_node(definition, execute, {
      pages: [
        {
          parent: { data_source_id: tasks_data_source },
          properties: title_property('Too long'),
          children_markdown: Array.from({ length: 101 }, (_, line) => `line ${line}`).join('\n'),
        },
        { parent: { data_source_id: tasks_data_source }, properties: title_property('Bug bash') },
      ],
    });

    expect(output.results[0]).toMatchObject({
      index: 0,
      ok: false,
      page_id: null,
      error: { code: 'node_failed', retryable: false },
    });
    expect(output.results[0]?.error?.message).toContain('at most 100 blocks');
    expect(output.results[1]).toMatchObject({ index: 1, ok: true, error: null });
    expect(calls).toHaveLength(1);
  });

  it('reports one refused parent without rolling back the page it already created', async () => {
    stub_notion_fetch((request) =>
      request.body?.includes('00000000-0000-0000-0000-000000000000')
        ? notion_json_response(fixtures.parent_not_shared, 404)
        : notion_json_response(fixtures.created_row),
    );

    const output = await run_notion_node(definition, execute, {
      pages: [
        { parent: { data_source_id: tasks_data_source }, properties: title_property('Bug bash') },
        {
          parent: { page_id: '00000000-0000-0000-0000-000000000000' },
          properties: title_property('Nowhere'),
        },
      ],
    });

    expect(output.results[0]).toMatchObject({
      ok: true,
      page_id: '397d9d71-e5b8-813f-b041-d7bf6a67ed23',
    });
    expect(output.results[1]).toMatchObject({
      ok: false,
      page_id: null,
      title: null,
      url: null,
      error: { code: 'provider_error', retryable: false },
    });
  });
});
