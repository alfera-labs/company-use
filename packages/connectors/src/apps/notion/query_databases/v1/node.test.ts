import {
  notion_json_response,
  run_notion_node,
  stub_notion_fetch,
} from '@connectors/apps/notion/notion_test_context';
import * as execute_module from '@connectors/apps/notion/query_databases/v1/execute';
import fixtures from '@connectors/apps/notion/query_databases/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/notion/query_databases/v1/node.json' with { type: 'json' };
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { JsonSchema } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = execute_module;

const tasks_data_source = 'd9824bdc-8445-4327-be8b-5b47500af6ce';
const notes_database = '5a7bc0de-3f21-4a9c-8b77-19d0c4ee5b12';
const notes_data_source = '7c1f4e88-1c2a-4a5b-9d3e-2b6f8a0c1d4f';

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notion-query_databases-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    const loaded = load_connector_node(
      'apps/notion/query_databases/v1/node.json',
      definition,
      execute_module,
    );
    expect(loaded.node_key).toBe('notion-query_databases-1');
    expect(loaded.execute).toBe(execute);
  });

  it('declares the key its folder proves, and the code that carries the work', () => {
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toEqual([]);
    expect(definition.description).toContain('bounded concurrent single requests');
  });

  it('is written as JSON Schema, plural on both sides with a cursor per table', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.response_schemas.query.$schema).toBe(draft);
    expect(definition.response_schemas.database.$schema).toBe(draft);
    expect(definition.input_schema.properties.queries.type).toBe('array');
    expect(definition.input_schema.required).toEqual(['queries']);
    expect(definition.output_schema.properties.results.type).toBe('array');
    expect(definition.output_schema.properties.results.items.required).toContain('next_cursor');
    expect(definition.output_schema.properties.results.items.required).toContain('error');
  });

  it('accepts every recorded Notion answer against its own schema', () => {
    const query_schema = definition.response_schemas.query as JsonSchema;
    const database_schema = definition.response_schemas.database as JsonSchema;
    expect(find_json_schema_violation(database_schema, fixtures.notes_database, 'db')).toBeNull();
    for (const page of [fixtures.tasks_query_page_one, fixtures.notes_query_last_page]) {
      expect(find_json_schema_violation(query_schema, page, 'response')).toBeNull();
    }
  });
});

describe('notion-query_databases-1', () => {
  it('reads two tables at once and resolves a database id to its data source', async () => {
    const calls = stub_notion_fetch((request) => {
      if (request.url.includes(`/databases/${notes_database}`)) {
        return notion_json_response(fixtures.notes_database);
      }
      return notion_json_response(
        request.url.includes(notes_data_source)
          ? fixtures.notes_query_last_page
          : fixtures.tasks_query_page_one,
      );
    });

    const output = await run_notion_node(definition, execute, {
      queries: [
        {
          data_source_id: tasks_data_source,
          filter: { property: 'Done', checkbox: { equals: false } },
          sorts: [{ property: 'Due date', direction: 'ascending' }],
          cursor: 'cur_01',
          limit: 50,
        },
        { database_id: notes_database },
      ],
    });

    expect(output.results[0]).toEqual({
      index: 0,
      data_source_id: tasks_data_source,
      ok: true,
      rows: [
        {
          id: 'be633bf1-dfa0-436d-b259-571129a590e5',
          title: 'Bug bash',
          url: 'https://www.notion.so/Bug-bash-be633bf1dfa0436db259571129a590e5',
          last_edited_time: '2023-03-08T18:25:00.000Z',
          properties: fixtures.tasks_query_page_one.results[0]?.properties,
        },
      ],
      next_cursor: 'c02fc1d3-db8b-45c5-a222-27595b15aea7',
      has_more: true,
      error: null,
    });
    expect(output.results[1]).toMatchObject({
      index: 1,
      data_source_id: notes_data_source,
      ok: true,
      next_cursor: null,
      has_more: false,
      error: null,
    });
    expect(output.results[1]?.rows[0]?.title).toBe('Kickoff');

    expect(calls).toHaveLength(3);
    const query_call = calls.find((call) => call.url.includes(`${tasks_data_source}/query`));
    expect(new URL(query_call?.url ?? '').pathname).toBe(
      `/v1/data_sources/${tasks_data_source}/query`,
    );
    expect(JSON.parse(query_call?.body ?? '{}')).toEqual({
      filter: { property: 'Done', checkbox: { equals: false } },
      sorts: [{ property: 'Due date', direction: 'ascending' }],
      start_cursor: 'cur_01',
      page_size: 50,
    });
    expect(query_call?.headers['Notion-Version']).toBe('2026-03-11');
  });

  it('reports one failed table without losing the rows of the other', async () => {
    stub_notion_fetch((request) =>
      request.url.includes(tasks_data_source)
        ? notion_json_response(fixtures.tasks_query_page_one)
        : notion_json_response(fixtures.data_source_not_found, 404),
    );

    const output = await run_notion_node(definition, execute, {
      queries: [
        { data_source_id: tasks_data_source },
        { data_source_id: '00000000-0000-0000-0000-000000000000' },
      ],
    });

    expect(output.results[0]).toMatchObject({ index: 0, ok: true, error: null });
    expect(output.results[1]).toMatchObject({
      index: 1,
      ok: false,
      rows: [],
      next_cursor: null,
      has_more: false,
      error: { code: 'provider_error', retryable: false },
    });
  });

  it('fails the one query that named no table at all', async () => {
    const calls = stub_notion_fetch(() => notion_json_response(fixtures.tasks_query_page_one));

    const output = await run_notion_node(definition, execute, {
      queries: [{ data_source_id: tasks_data_source }, {}],
    });

    expect(output.results[0]).toMatchObject({ ok: true });
    expect(output.results[1]).toMatchObject({
      ok: false,
      data_source_id: null,
      error: { code: 'node_failed', message: 'Give either data_source_id or database_id.' },
    });
    expect(calls).toHaveLength(1);
  });
});
