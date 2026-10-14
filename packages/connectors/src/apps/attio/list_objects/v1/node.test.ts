import app_definition from '@connectors/apps/attio/app.json' with { type: 'json' };
import fixtures from '@connectors/apps/attio/list_objects/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/attio/list_objects/v1/node.json' with { type: 'json' };
import { execute_node } from '@connectors/runtime/execute_node';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { browse_scope_options, find_sync_dimension } from '@connectors/sync_scope';
import type { ConnectorConnection } from '@connectors/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connection: ConnectorConnection = {
  connection_id: 'conn_attio_fixture',
  access_token: 'token_attio',
};

function stub_attio_fetch(body: unknown, status = 200) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method) });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attio-list_objects-1 node.json', () => {
  it('needs no code: the whole call is a declarative http mapping', () => {
    expect(definition.node_key).toBe('attio-list_objects-1');
    expect(definition.implementation).toBe('http');
    expect(definition.http.method).toBe('GET');
    expect(definition.http.path).toBe('/v2/objects');
    expect(definition.required_scopes).toEqual(['object_configuration:read']);
  });

  it('takes the browse input and answers with the scope-option shape', () => {
    expect(Object.keys(definition.input_schema.properties)).toEqual([
      'parent_id',
      'query',
      'cursor',
      'limit',
    ]);
    expect(definition.output_schema.required).toEqual(['options', 'next_cursor']);
  });

  it('is the browse node the app sync declaration points at', () => {
    expect(app_definition.sync.dimensions[0]).toMatchObject({
      key: 'objects',
      shape: 'flat',
      browse_node: 'attio-list_objects-1',
    });
  });
});

describe('attio-list_objects-1', () => {
  it('maps a recorded answer onto pickable options keyed by the api_slug', async () => {
    const calls = stub_attio_fetch(fixtures.objects_list);

    const result = await execute_node('attio-list_objects-1', {}, connection);

    expect(calls[0]?.method).toBe('GET');
    expect(new URL(calls[0]?.url ?? '').origin + new URL(calls[0]?.url ?? '').pathname).toBe(
      'https://api.attio.com/v2/objects',
    );
    expect(result).toEqual({
      ok: true,
      data: {
        options: [
          { id: 'people', label: 'People', kind: 'object', selectable: true },
          { id: 'companies', label: 'Companies', kind: 'object', selectable: true },
          {
            id: 'a1c9d0e2-77b4-4c31-8f5a-6e2b9d4c7a10',
            label: 'a1c9d0e2-77b4-4c31-8f5a-6e2b9d4c7a10',
            kind: 'object',
            selectable: true,
          },
        ],
        next_cursor: null,
      },
    });
  });

  it('accepts the browse input the picker sends and ignores what Attio cannot use', async () => {
    stub_attio_fetch(fixtures.objects_list);

    const result = await execute_node(
      'attio-list_objects-1',
      { parent_id: 'people', query: 'peo', cursor: '100', limit: 5 },
      connection,
    );

    expect(result.ok).toBe(true);
  });

  it('refuses an input its own schema does not allow', async () => {
    stub_attio_fetch(fixtures.objects_list);

    expect(
      await execute_node('attio-list_objects-1', { object: 'people' }, connection),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('turns a refused token into the error contract, not an empty page', async () => {
    const calls = stub_attio_fetch(fixtures.objects_unauthorized, 401);

    const result = await execute_node('attio-list_objects-1', {}, connection);

    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized', retryable: false } });
    expect(calls).toHaveLength(1);
  });

  it('serves the sync picker through the same node', async () => {
    stub_attio_fetch(fixtures.objects_list);
    const dimension = find_sync_dimension('attio');

    const result = await browse_scope_options(
      'attio-list_objects-1',
      {},
      connection,
      dimension ?? { key: 'objects', label: 'Objects', shape: 'flat', browse_node: '' },
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        options: [
          { id: 'people', label: 'People' },
          { id: 'companies' },
          { id: 'a1c9d0e2-77b4-4c31-8f5a-6e2b9d4c7a10' },
        ],
      },
    });
  });
});
