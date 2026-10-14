import { execute_node } from '@connectors/runtime/execute_node';
import { get_node_schema } from '@connectors/runtime/get_node_schema';
import {
  build_connector_url,
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorApp, ConnectorConnection } from '@connectors/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connection: ConnectorConnection = {
  connection_id: 'conn_execute_door',
  access_token: 'token_abc',
};

type RecordedRequest = { url: string; init: RequestInit };

function json_response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function stub_fetch(answer: (call_count: number) => Response) {
  const calls: RecordedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return answer(calls.length);
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

describe('execute_node', () => {
  it('runs the declarative http mapping end to end', async () => {
    const calls = stub_fetch(() =>
      json_response({
        echoed: [
          { id: 'itm_01', value: 'first' },
          { id: 'itm_02', value: 'second' },
        ],
        next_cursor: 'cur_02',
        request_id: 'req_9f2c1a',
      }),
    );

    const result = await execute_node(
      'example-echo_items-1',
      { items: ['first', 'second'], cursor: 'cur_01', limit: 25 },
      connection,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          { id: 'itm_01', text: 'first' },
          { id: 'itm_02', text: 'second' },
        ],
        next_cursor: 'cur_02',
      },
    });

    const call = calls[0];
    expect(call?.url).toBe('https://example.invalid/api/echo?cursor=cur_01&limit=25');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.body).toBe(JSON.stringify({ items: ['first', 'second'] }));
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token_abc');
  });

  it('omits the cursor when the caller asks for the first page', async () => {
    const calls = stub_fetch(() => json_response({ echoed: [], next_cursor: null }));

    const result = await execute_node('example-echo_items-1', { items: ['only'] }, connection);

    expect(result).toEqual({ ok: true, data: { items: [], next_cursor: null } });
    expect(calls[0]?.url).toBe('https://example.invalid/api/echo');
  });

  it('answers unknown_node instead of throwing', async () => {
    const result = await execute_node('example-missing-1', { items: ['a'] }, connection);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unknown_node',
        message: 'No connector node named example-missing-1.',
        retryable: false,
      },
    });
  });

  it('rejects input that fails the node schema before touching the network', async () => {
    const calls = stub_fetch(() => json_response({ echoed: [], next_cursor: null }));

    const result = await execute_node('example-echo_items-1', { items: [] }, connection);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('reports a refused credential as unauthorized and does not retry it', async () => {
    const calls = stub_fetch(() => json_response({ error: 'bad_token' }, 401));

    const result = await execute_node('example-echo_items-1', { items: ['a'] }, connection);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('unauthorized');
    expect(result.error.retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('retries a 429 after Retry-After and returns the eventual success', async () => {
    const calls = stub_fetch((call_count) =>
      call_count === 1
        ? json_response({ error: 'rate_limited' }, 429, { 'Retry-After': '0' })
        : json_response({ echoed: [{ id: 'itm_03', value: 'third' }], next_cursor: null }),
    );

    const result = await execute_node('example-echo_items-1', { items: ['third'] }, connection);

    expect(result).toEqual({
      ok: true,
      data: { items: [{ id: 'itm_03', text: 'third' }], next_cursor: null },
    });
    expect(calls).toHaveLength(2);
  });

  it('gives up on a persistent 500 with a retryable error after four attempts', async () => {
    const calls = stub_fetch(() => json_response({ error: 'boom' }, 500));

    const result = await execute_node('example-echo_items-1', { items: ['a'] }, connection);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('provider_error');
    expect(result.error.retryable).toBe(true);
    expect(calls).toHaveLength(4);
  }, 20_000);

  it('reports a provider response that no longer matches the schema', async () => {
    stub_fetch(() => json_response({ echoed: [{ id: 'itm_01' }], next_cursor: null }));

    const result = await execute_node('example-echo_items-1', { items: ['a'] }, connection);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('invalid_provider_response');
    expect(result.error.retryable).toBe(false);
  });

  it('reports a network failure as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const result = await execute_node('example-echo_items-1', { items: ['a'] }, connection);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('network_error');
    expect(result.error.retryable).toBe(true);
  }, 20_000);

  it('reports an aborted request as cancelled and does not retry it', async () => {
    const controller = new AbortController();
    const calls = stub_fetch(() => {
      controller.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    });

    const result = await execute_node('example-echo_items-1', { items: ['a'] }, connection, {
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('cancelled');
    expect(result.error.retryable).toBe(false);
    expect(calls).toHaveLength(1);
  }, 20_000);
});

describe('a node that carries an execute.ts', () => {
  it('runs the plural contract through fan_out, one provider call per item', async () => {
    const calls = stub_fetch(() => json_response({ id: 'itm_01', value: 'first' }));

    const result = await execute_node(
      'example-collect_items-1',
      { item_ids: ['itm_01', 'itm_02'] },
      connection,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          { id: 'itm_01', text: 'first' },
          { id: 'itm_01', text: 'first' },
        ],
        failures: [],
      },
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://example.invalid/api/items/itm_01',
      'https://example.invalid/api/items/itm_02',
    ]);
  });

  it('keeps the successes when one item fails', async () => {
    stub_fetch((call_count) =>
      call_count === 2
        ? json_response({ error: 'gone' }, 404)
        : json_response({ id: 'itm_01', value: 'first' }),
    );

    const result = await execute_node(
      'example-collect_items-1',
      { item_ids: ['itm_01', 'itm_02'] },
      connection,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a success');
    const data = result.data as { items: unknown[]; failures: { index: number }[] };
    expect(data.items).toHaveLength(1);
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0]?.index).toBe(1);
  });

  it('validates the input before the node own code runs', async () => {
    const calls = stub_fetch(() => json_response({ id: 'itm_01', value: 'first' }));

    const result = await execute_node('example-collect_items-1', { item_ids: [] }, connection);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('invalid_input');
    expect(calls).toHaveLength(0);
  });
});

describe('reading the provider answer', () => {
  const example_app: ConnectorApp = {
    app_key: 'example',
    display_name: 'Example',
    base_url: 'https://example.invalid/api',
    rate_limits: { rpm: 6000, concurrency: 4, burst: 10 },
    auth: { kind: 'none' },
  };

  it('repeats a query parameter for an array instead of comma-joining it', () => {
    const url = build_connector_url('https://example.invalid/api', '/messages', {
      labelIds: ['INBOX', 'UNREAD'],
      q: 'from:me',
      page_token: undefined,
    });
    expect(url).toBe(
      'https://example.invalid/api/messages?labelIds=INBOX&labelIds=UNREAD&q=from%3Ame',
    );
  });

  it('reads a text endpoint as the document, not as JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# An exported document', { status: 200 })),
    );

    const body = await send_connector_http_request<string>({
      app: example_app,
      connection,
      method: 'GET',
      path: '/files/abc/export',
      response_format: 'text',
      response_schema: { type: 'string' },
    });

    expect(body).toBe('# An exported document');
  });

  it('reads a 204 with an empty body as a null success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const body = await send_connector_http_request({
      app: example_app,
      connection,
      method: 'POST',
      path: '/messages/batchModify',
      response_schema: { type: 'null' },
    });

    expect(body).toBeNull();
  });

  it('hands the node the headers a provider paginates with', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ id: 1 }]), {
            status: 200,
            headers: {
              Link: '<https://example.invalid/api/issues?page=2>; rel="next"',
              ETag: 'W/"abc"',
              'X-Secret-Quota': 'not for nodes',
            },
          }),
      ),
    );

    const response = await send_connector_http_response({
      app: example_app,
      connection,
      method: 'GET',
      path: '/issues',
      response_schema: { type: 'array' },
    });

    expect(response.headers.link).toBe('<https://example.invalid/api/issues?page=2>; rel="next"');
    expect(response.headers.etag).toBe('W/"abc"');
    expect(response.headers['x-secret-quota']).toBeUndefined();
    expect(response.status).toBe(200);
  });

  it('treats a 403 carrying Retry-After as rate limiting, not a refused credential', async () => {
    const calls = stub_fetch((call_count) =>
      call_count === 1
        ? json_response({ message: 'secondary rate limit' }, 403, { 'Retry-After': '0' })
        : json_response({ echoed: [{ id: 'itm_04', value: 'fourth' }], next_cursor: null }),
    );

    const result = await execute_node('example-echo_items-1', { items: ['fourth'] }, connection);

    expect(result).toEqual({
      ok: true,
      data: { items: [{ id: 'itm_04', text: 'fourth' }], next_cursor: null },
    });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['x-ratelimit-remaining: 0', { message: 'Forbidden' }, { 'x-ratelimit-remaining': '0' }],
    [
      'a rate limit message',
      { message: 'You have exceeded a secondary rate limit. Please wait a few minutes.' },
      {},
    ],
  ])('treats a 403 with %s as rate limiting, not a refused credential', async (_signal, body, headers) => {
    const calls = stub_fetch((call_count) =>
      call_count === 1
        ? json_response(body, 403, headers)
        : json_response({ echoed: [{ id: 'itm_05', value: 'fifth' }], next_cursor: null }),
    );

    const result = await execute_node('example-echo_items-1', { items: ['fifth'] }, connection);

    expect(result).toEqual({
      ok: true,
      data: { items: [{ id: 'itm_05', text: 'fifth' }], next_cursor: null },
    });
    expect(calls).toHaveLength(2);
  });

  it('still reads a bare 403 as a refused credential', async () => {
    const calls = stub_fetch(() => json_response({ message: 'forbidden' }, 403));

    const result = await execute_node('example-echo_items-1', { items: ['a'] }, connection);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('unauthorized');
    expect(calls).toHaveLength(1);
  });
});

describe('get_node_schema', () => {
  it('hands back the JSON Schema node.json already holds', () => {
    const schema = get_node_schema('example-echo_items-1');
    expect(schema?.description).toBe('Echo a batch of items back, one page at a time.');
    expect(schema?.input_schema.required).toEqual(['items']);
    expect(schema?.input_schema.properties?.items).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
    expect(schema?.output_schema.required).toEqual(['items', 'next_cursor']);
    expect(get_node_schema('example-missing-1')).toBeNull();
  });
});
