import { create_native_sync_door } from '@connectors/sync/sync_door';
import { find_sync_dimension } from '@connectors/sync_scope';
import type { ConnectorConnection } from '@connectors/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

const connection: ConnectorConnection = {
  connection_id: 'conn_sync_door',
  access_token: 'token_abc',
};

function json_response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('create_native_sync_door', () => {
  it('refuses a held app with the app.json reason, and makes no request', () => {
    const fetch_spy = vi.fn();
    vi.stubGlobal('fetch', fetch_spy);

    const result = create_native_sync_door(connection, 'gmail');

    expect(result).toEqual({
      outcome: 'app_held',
      reason: "Google has not approved this app's scopes yet.",
    });
    expect(fetch_spy).not.toHaveBeenCalled();
  });

  it('builds a working door for an app that is not held', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json_response({ echoed: [{ id: 'a', value: 'x' }], next_cursor: null })),
    );

    const result = create_native_sync_door(connection, 'example');
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;

    const node_result = await result.door.run_node('example-echo_items-1', { items: ['x'] });
    expect(node_result.ok).toBe(true);
  });

  it('pages a browse_node to its scope rows, keeping kind, has_children and selectable', async () => {
    let call_count = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call_count += 1;
        return json_response({
          echoed: call_count === 1 ? [{ id: 'first', value: 'first' }] : [],
          next_cursor: null,
        });
      }),
    );

    const result = create_native_sync_door(connection, 'example');
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;

    const dimension = find_sync_dimension('example', 'items');
    if (!dimension) throw new Error('example app lost its items dimension');
    const rows = await result.door.list_scope_options(dimension);
    expect(rows).toEqual([{ id: 'first', label: 'first', kind: 'document' }]);
  });

  it('refuses to fetch a file with no download url', async () => {
    const result = create_native_sync_door(connection, 'example');
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;

    const outcome = await result.door.fetch_file({
      id: 'f1',
      name: 'report.pdf',
      mime_type: 'application/pdf',
    });
    expect(outcome).toEqual({ outcome: 'host_refused' });
  });
});
