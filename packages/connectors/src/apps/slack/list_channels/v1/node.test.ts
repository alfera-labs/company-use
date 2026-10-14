import fixtures from '@connectors/apps/slack/list_channels/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/slack/list_channels/v1/node.json' with { type: 'json' };
import { execute_node } from '@connectors/runtime/execute_node';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { browse_scope_options, find_sync_dimension } from '@connectors/sync_scope';
import type { ConnectorConnection } from '@connectors/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connection: ConnectorConnection = {
  connection_id: 'conn_slack_fixture',
  access_token: 'xoxb-test-token',
};

function stub_fetch_with(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), {
        status: 200,
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

describe('slack-list_channels-1 definition', () => {
  it('declares the key its folder proves, its scope, and its call', () => {
    expect(definition.node_key).toBe('slack-list_channels-1');
    expect(definition.required_scopes).toEqual(['channels:read']);
    expect(definition.implementation).toBe('execute');
    expect(definition.requests.conversations_list.method).toBe('GET');
    expect(definition.requests.conversations_list.path).toBe('/conversations.list');
    expect(definition.description.trim().length).toBeGreaterThan(0);
  });

  it('takes a cursor and a limit in, and returns channels plus a nullable cursor', () => {
    expect(Object.keys(definition.input_schema.properties)).toEqual([
      'cursor',
      'limit',
      'exclude_archived',
    ]);
    expect(definition.output_schema.required).toEqual(['channels', 'next_cursor']);
    expect(definition.output_schema.properties.next_cursor.type).toEqual(['string', 'null']);
  });

  it('rejects an input its own schema does not allow', async () => {
    stub_fetch_with(fixtures.conversations_list_page_one);

    expect(await execute_node('slack-list_channels-1', { limit: 0 }, connection)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(
      await execute_node('slack-list_channels-1', { channel: 'C012AB3CD' }, connection),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});

describe('slack-list_channels-1', () => {
  it('maps a recorded page onto the node output', async () => {
    stub_fetch_with(fixtures.conversations_list_page_one);

    const result = await execute_node('slack-list_channels-1', { limit: 2 }, connection);

    expect(result).toEqual({
      ok: true,
      data: {
        channels: [
          { id: 'C012AB3CD', name: 'general', is_private: false, num_members: 4 },
          { id: 'C061EG9T2', name: 'random', is_private: false, num_members: 4 },
        ],
        next_cursor: 'dGVhbTpDMDYxRkE1UEI=',
      },
    });
  });

  it('asks Slack for public channels only, with the caller cursor and limit', async () => {
    const calls = stub_fetch_with(fixtures.conversations_list_page_one);

    await execute_node(
      'slack-list_channels-1',
      { cursor: 'dGVhbTpDMDYxRkE1UEI=', limit: 50 },
      connection,
    );

    const url = new URL(calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://slack.com/api/conversations.list');
    expect(url.searchParams.get('types')).toBe('public_channel');
    expect(url.searchParams.get('exclude_archived')).toBe('true');
    expect(url.searchParams.get('cursor')).toBe('dGVhbTpDMDYxRkE1UEI=');
    expect(url.searchParams.get('limit')).toBe('50');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer xoxb-test-token');
  });

  it('reports the last page as a null cursor and a missing member count as null', async () => {
    stub_fetch_with(fixtures.conversations_list_last_page);

    const result = await execute_node('slack-list_channels-1', {}, connection);

    expect(result).toEqual({
      ok: true,
      data: {
        channels: [
          { id: 'C07QWERTY', name: 'design-partners', is_private: false, num_members: null },
        ],
        next_cursor: null,
      },
    });
  });

  it('turns an HTTP 200 ok=false into the error contract', async () => {
    const calls = stub_fetch_with(fixtures.conversations_list_missing_scope);

    const result = await execute_node('slack-list_channels-1', {}, connection);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unauthorized',
        message: 'Slack conversations.list answered ok=false: missing_scope',
        retryable: false,
      },
    });
    expect(calls).toHaveLength(1);
  });
});

describe('slack channels sync dimension', () => {
  it('browses the channels a person picks from through this node', async () => {
    stub_fetch_with(fixtures.conversations_list_page_one);
    const dimension = find_sync_dimension('slack');

    const result = await browse_scope_options(
      dimension?.browse_node ?? '',
      { limit: 2 },
      connection,
      dimension ?? { key: 'channels', label: 'Channels', shape: 'flat', browse_node: '' },
    );

    expect(dimension).toMatchObject({
      key: 'channels',
      shape: 'flat',
      browse_node: 'slack-list_channels-1',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        options: [
          { id: 'C012AB3CD', label: 'general', kind: 'channel', selectable: true },
          { id: 'C061EG9T2', label: 'random', kind: 'channel', selectable: true },
        ],
        next_cursor: 'dGVhbTpDMDYxRkE1UEI=',
      },
    });
  });

  it('falls back to the channel id when Slack sends a channel with no name', async () => {
    stub_fetch_with({
      ok: true,
      channels: [{ id: 'C09NONAME' }],
      response_metadata: { next_cursor: '' },
    });
    const dimension = find_sync_dimension('slack', 'channels');

    const result = await browse_scope_options(
      'slack-list_channels-1',
      {},
      connection,
      dimension ?? { key: 'channels', label: 'Channels', shape: 'flat', browse_node: '' },
    );

    expect(result).toMatchObject({
      ok: true,
      data: { options: [{ id: 'C09NONAME', label: 'C09NONAME' }], next_cursor: null },
    });
  });
});
