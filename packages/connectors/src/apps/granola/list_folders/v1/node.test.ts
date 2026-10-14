import app_definition from '@connectors/apps/granola/app.json' with { type: 'json' };
import fixtures from '@connectors/apps/granola/list_folders/v1/fixtures.json' with { type: 'json' };
import node_definition from '@connectors/apps/granola/list_folders/v1/node.json' with {
  type: 'json',
};
import { execute_node } from '@connectors/runtime/execute_node';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { browse_scope_options, find_sync_dimension } from '@connectors/sync_scope';
import type { ConnectorConnection } from '@connectors/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connection: ConnectorConnection = {
  connection_id: 'conn_granola_fixture',
  access_token: 'grn_test_key',
};

function stub_fetch_with(body: unknown, status = 200) {
  const request_urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      request_urls.push(String(url));
      return new Response(JSON.stringify(body), {
        status,
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

describe('granola-list_folders-1 declaration', () => {
  it('needs no code: the whole call is a declarative http mapping', () => {
    expect(node_definition.node_key).toBe('granola-list_folders-1');
    expect(node_definition.implementation).toBe('http');
    expect(node_definition.provider.endpoint).toBe('GET /v1/folders');
    expect(node_definition.http.path).toBe('/v1/folders');
    expect(node_definition.required_scopes).toEqual(['personal_notes', 'public_notes']);
  });

  it('takes the browse input and answers with the scope-option shape', () => {
    expect(Object.keys(node_definition.input_schema.properties)).toEqual([
      'parent_id',
      'query',
      'cursor',
      'limit',
    ]);
    expect(node_definition.output_schema.required).toEqual(['options', 'next_cursor']);
  });

  it('caps the page size where Granola caps it', () => {
    expect(node_definition.input_schema.properties.limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 30,
    });
  });

  it('is the browse node the app sync declaration points at', () => {
    expect(app_definition.sync.dimensions[0]).toMatchObject({
      key: 'folders',
      shape: 'flat',
      browse_node: 'granola-list_folders-1',
    });
  });
});

describe('granola-list_folders-1', () => {
  it('maps a page of folders onto pickable options', async () => {
    const request_urls = stub_fetch_with(fixtures.folders_page_one);

    const result = await execute_node('granola-list_folders-1', { limit: 2 }, connection);

    expect(result).toEqual({
      ok: true,
      data: {
        options: [
          {
            id: 'fol_00000000000001',
            label: 'Top secret recipes',
            kind: 'folder',
            selectable: true,
          },
          {
            id: 'fol_00000000000002',
            label: 'Customer calls',
            kind: 'folder',
            selectable: true,
          },
        ],
        next_cursor: 'eyJjcmVkZW50aWFsfQ==',
      },
    });

    const url = new URL(request_urls[0] as string);
    expect(url.origin + url.pathname).toBe('https://public-api.granola.ai/v1/folders');
    expect(Object.fromEntries(url.searchParams)).toEqual({ page_size: '2' });
  });

  it('sends the caller cursor and reports the last page as a null cursor', async () => {
    const request_urls = stub_fetch_with(fixtures.folders_last_page);

    const result = await execute_node(
      'granola-list_folders-1',
      { cursor: 'eyJjcmVkZW50aWFsfQ==' },
      connection,
    );

    expect(new URL(request_urls[0] as string).searchParams.get('cursor')).toBe(
      'eyJjcmVkZW50aWFsfQ==',
    );
    expect(result).toEqual({
      ok: true,
      data: {
        options: [
          {
            id: 'fol_00000000000003',
            label: 'fol_00000000000003',
            kind: 'folder',
            selectable: true,
          },
        ],
        next_cursor: null,
      },
    });
  });

  it('refuses a page size Granola would refuse, before any request', async () => {
    const request_urls = stub_fetch_with(fixtures.folders_page_one);

    expect(await execute_node('granola-list_folders-1', { limit: 50 }, connection)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(request_urls).toHaveLength(0);
  });

  it('turns a refused key into the error contract, not an empty page', async () => {
    const request_urls = stub_fetch_with(fixtures.folders_unauthorized, 401);

    const result = await execute_node('granola-list_folders-1', {}, connection);

    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized', retryable: false } });
    expect(request_urls).toHaveLength(1);
  });

  it('serves the sync picker through the same node', async () => {
    stub_fetch_with(fixtures.folders_page_one);
    const dimension = find_sync_dimension('granola');

    const result = await browse_scope_options(
      'granola-list_folders-1',
      { limit: 2 },
      connection,
      dimension ?? { key: 'folders', label: 'Folders', shape: 'flat', browse_node: '' },
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        options: [
          { id: 'fol_00000000000001', label: 'Top secret recipes' },
          { id: 'fol_00000000000002', label: 'Customer calls' },
        ],
        next_cursor: 'eyJjcmVkZW50aWFsfQ==',
      },
    });
  });
});
