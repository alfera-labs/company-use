import app_definition from '@connectors/apps/granola/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/granola/list_notes/v1/execute';
import fixtures from '@connectors/apps/granola/list_notes/v1/fixtures.json' with { type: 'json' };
import node_definition from '@connectors/apps/granola/list_notes/v1/node.json' with {
  type: 'json',
};
import { load_connector_app } from '@connectors/load_definition';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorConnection, ConnectorNodeContext } from '@connectors/types';
import { create_logger } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = load_connector_app('apps/granola/app.json', app_definition);
const connection: ConnectorConnection = {
  connection_id: 'conn_granola_fixture',
  access_token: 'grn_test_key',
};

const context: ConnectorNodeContext = {
  app,
  connection: { connection_id: connection.connection_id },
  send_request: (request) => send_connector_http_request({ app, connection, ...request }),
  send_request_for_response: (request) =>
    send_connector_http_response({ app, connection, ...request }),
  fan_out,
  log: create_logger('granola_list_notes_test'),
};

function stub_fetch_with(body: unknown) {
  const request_urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      request_urls.push(url);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return request_urls;
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('granola-list_notes-1 declaration', () => {
  it('names the key its own folder proves, and points at a real endpoint', () => {
    expect(node_definition.node_key).toBe('granola-list_notes-1');
    expect(node_definition.implementation).toBe('execute');
    expect(node_definition.provider.endpoint).toBe('GET /v1/notes');
    expect(node_definition.required_scopes).toEqual(['personal_notes', 'public_notes']);
    expect(node_definition.description.length).toBeGreaterThan(40);
  });

  it('declares a plural output: an array plus a cursor', () => {
    expect(Object.keys(node_definition.output_schema.properties)).toEqual([
      'notes',
      'next_cursor',
      'has_more',
    ]);
    expect(node_definition.output_schema.properties.notes.type).toBe('array');
    expect(node_definition.output_schema.properties.next_cursor.type).toEqual(['string', 'null']);
  });

  it('caps the page size where Granola caps it', () => {
    expect(node_definition.input_schema.properties.limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 30,
    });
  });
});

describe('granola-list_notes-1', () => {
  it('maps a page of notes and carries every filter into the query string', async () => {
    const request_urls = stub_fetch_with(fixtures.notes_page_one);

    const output = await execute(
      {
        created_after: '2026-01-20',
        updated_after: '2026-01-25T00:00:00Z',
        folder_id: 'fol_00000000000001',
        limit: 2,
      },
      context,
    );

    expect(output).toEqual({
      notes: [
        {
          id: 'not_00000000000001',
          title: 'Quarterly widget budget review',
          owner: { name: 'Pat Sample', email: 'pat@granola.ai' },
          created_at: '2026-01-27T15:30:00Z',
          updated_at: '2026-01-27T16:45:00Z',
        },
        {
          id: 'not_00000000000002',
          title: null,
          owner: { name: null, email: 'raisin@granola.ai' },
          created_at: '2026-01-26T09:00:00Z',
          updated_at: '2026-01-26T09:40:00Z',
        },
      ],
      next_cursor: 'eyJjcmVkZW50aWFsfQ==',
      has_more: true,
    });

    const url = new URL(request_urls[0] as string);
    expect(url.origin + url.pathname).toBe('https://public-api.granola.ai/v1/notes');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      created_after: '2026-01-20',
      updated_after: '2026-01-25T00:00:00Z',
      folder_id: 'fol_00000000000001',
      page_size: '2',
    });
  });

  it('returns exactly the keys node.json promises', async () => {
    stub_fetch_with(fixtures.notes_page_one);

    const output = await execute({}, context);

    expect(Object.keys(output).sort()).toEqual(
      Object.keys(node_definition.output_schema.properties).sort(),
    );
    expect(Object.keys(output.notes[0] ?? {}).sort()).toEqual(
      Object.keys(node_definition.output_schema.properties.notes.items.properties).sort(),
    );
  });

  it('sends the caller cursor and reports the end of the list as a null cursor', async () => {
    const request_urls = stub_fetch_with(fixtures.notes_last_page);

    const output = await execute({ cursor: 'eyJjcmVkZW50aWFsfQ==' }, context);

    expect(output.notes).toHaveLength(1);
    expect(output.notes[0]?.id).toBe('not_00000000000003');
    expect(output.next_cursor).toBeNull();
    expect(output.has_more).toBe(false);
    expect(new URL(request_urls[0] as string).searchParams.get('cursor')).toBe(
      'eyJjcmVkZW50aWFsfQ==',
    );
  });

  it('turns a refused key into a typed unauthorized error, not a retry storm', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(execute({}, context)).rejects.toMatchObject({
      code: 'unauthorized',
      retryable: false,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
