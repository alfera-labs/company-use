import {
  notion_json_response,
  run_notion_node,
  stub_notion_fetch,
} from '@connectors/apps/notion/notion_test_context';
import * as execute_module from '@connectors/apps/notion/read_blocks/v1/execute';
import fixtures from '@connectors/apps/notion/read_blocks/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/notion/read_blocks/v1/node.json' with { type: 'json' };
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { JsonSchema } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = execute_module;

const agenda_page = 'c02fc1d3-db8b-45c5-a222-27595b15aea7';
const checklist_page = 'd13ec2e4-ec99-4c66-8ea4-2b8b2ef1a1cc';

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notion-read_blocks-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    const loaded = load_connector_node(
      'apps/notion/read_blocks/v1/node.json',
      definition,
      execute_module,
    );
    expect(loaded.node_key).toBe('notion-read_blocks-1');
    expect(loaded.execute).toBe(execute);
  });

  it('declares the key its folder proves, and the code that carries the work', () => {
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toEqual([]);
    expect(definition.quirks.endpoint).toBe('GET /v1/blocks/{block_id}/children');
  });

  it('is written as JSON Schema, plural on both sides with a cursor per block', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.response_schemas.block_children.$schema).toBe(draft);
    expect(definition.input_schema.properties.blocks.type).toBe('array');
    expect(definition.input_schema.required).toEqual(['blocks']);
    expect(definition.output_schema.properties.results.items.required).toContain('next_cursor');
  });

  it('accepts every recorded Notion answer against its own schema', () => {
    const schema = definition.response_schemas.block_children as JsonSchema;
    for (const page of [fixtures.block_children_page_one, fixtures.block_children_last_page]) {
      expect(find_json_schema_violation(schema, page, 'response')).toBeNull();
    }
  });
});

describe('notion-read_blocks-1', () => {
  it('flattens every block type it is handed, and keeps the ones with no text', async () => {
    const calls = stub_notion_fetch((request) =>
      notion_json_response(
        request.url.includes(agenda_page)
          ? fixtures.block_children_page_one
          : fixtures.block_children_last_page,
      ),
    );

    const output = await run_notion_node(definition, execute, {
      blocks: [
        { block_id: agenda_page, limit: 100 },
        { block_id: checklist_page, cursor: 'cur_04' },
      ],
    });

    expect(output.results[0]).toEqual({
      index: 0,
      block_id: agenda_page,
      ok: true,
      blocks: [
        {
          id: 'c02fc1d3-db8b-45c5-a222-27595b15aea8',
          type: 'heading_2',
          text: 'Agenda',
          has_children: false,
        },
        {
          id: 'c02fc1d3-db8b-45c5-a222-27595b15aea9',
          type: 'paragraph',
          text: 'Ship the connector',
          has_children: false,
        },
        {
          id: 'c02fc1d3-db8b-45c5-a222-27595b15aeb0',
          type: 'bulleted_list_item',
          text: 'Triage P0s',
          has_children: true,
        },
        {
          id: 'c02fc1d3-db8b-45c5-a222-27595b15aeb1',
          type: 'image',
          text: '',
          has_children: false,
        },
      ],
      next_cursor: 'c02fc1d3-db8b-45c5-a222-27595b15aea7',
      has_more: true,
      error: null,
    });

    expect(output.results[1]).toMatchObject({
      index: 1,
      block_id: checklist_page,
      ok: true,
      blocks: [
        {
          id: 'd13ec2e4-ec99-4c66-8ea4-2b8b2ef1a1cd',
          type: 'to_do',
          text: 'Write the fixtures',
          has_children: false,
        },
        {
          id: 'd13ec2e4-ec99-4c66-8ea4-2b8b2ef1a1ce',
          type: 'divider',
          text: '',
          has_children: false,
        },
      ],
      next_cursor: null,
      has_more: false,
      error: null,
    });

    expect(calls).toHaveLength(2);
    const first_call = new URL(calls[0]?.url ?? '');
    expect(first_call.pathname).toBe(`/v1/blocks/${agenda_page}/children`);
    expect(first_call.searchParams.get('page_size')).toBe('100');
    expect(first_call.searchParams.has('start_cursor')).toBe(false);
    expect(calls[0]?.headers['Notion-Version']).toBe('2026-03-11');
    expect(new URL(calls[1]?.url ?? '').searchParams.get('start_cursor')).toBe('cur_04');
  });

  it('reports one unreachable block without losing the other', async () => {
    stub_notion_fetch((request) =>
      request.url.includes(agenda_page)
        ? notion_json_response(fixtures.block_children_page_one)
        : notion_json_response(fixtures.block_not_found, 404),
    );

    const output = await run_notion_node(definition, execute, {
      blocks: [{ block_id: agenda_page }, { block_id: '00000000-0000-0000-0000-000000000000' }],
    });

    expect(output.results[0]).toMatchObject({ index: 0, ok: true, error: null });
    expect(output.results[1]).toMatchObject({
      index: 1,
      block_id: '00000000-0000-0000-0000-000000000000',
      ok: false,
      blocks: [],
      next_cursor: null,
      has_more: false,
      error: { code: 'provider_error', retryable: false },
    });
  });
});
