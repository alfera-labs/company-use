import fixtures from '@connectors/apps/example/echo_items/v1/fixtures.json' with { type: 'json' };
import { execute_node } from '@connectors/runtime/execute_node';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorConnection } from '@connectors/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connection: ConnectorConnection = {
  connection_id: 'conn_example_fixture',
  access_token: 'token_example',
};

function stub_fetch_with(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('example-echo_items-1', () => {
  it('maps a recorded page onto the node output', async () => {
    stub_fetch_with(fixtures.echo_items_page_one);

    const result = await execute_node(
      'example-echo_items-1',
      { items: ['first', 'second'], limit: 2 },
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
  });

  it('reports the end of the batch as a null cursor', async () => {
    stub_fetch_with(fixtures.echo_items_last_page);

    const result = await execute_node(
      'example-echo_items-1',
      { items: ['third'], cursor: 'cur_02' },
      connection,
    );

    expect(result).toEqual({
      ok: true,
      data: { items: [{ id: 'itm_03', text: 'third' }], next_cursor: null },
    });
  });
});
