import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  good_api_key,
  stub_keyed_mcp_server,
} from '@runtime-platform/connections/__tests__/mcp_keyed_server_stub';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { send_mcp_request } from '@runtime-platform/tools/mcp/mcp_transport';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

const server_url = 'https://notes.acme.test/mcp';

afterEach(() => vi.unstubAllGlobals());

describe('the headers of a request to an MCP server', () => {
  it.each([
    'Host',
    'content-type',
    'ACCEPT',
    'Mcp-Session-Id',
    'mcp-protocol-version',
  ])('refuses an add that gives the %s header, which Alfera sets itself', async (name) => {
    const send = stub_keyed_mcp_server();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      authentication: 'none',
      request_headers: { 'X-Api-Key': good_api_key, [name]: 'chosen-by-an-admin' },
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    expect(outcome).toEqual({
      kind: 'refused',
      because: `Alfera sets the ${name} header itself. Take it out of the additional request headers.`,
    });
    expect(send).not.toHaveBeenCalled();
    expect(await db.query.connections.findMany()).toEqual([]);
  });

  it('sets its own headers over the ones an old stored connection holds, whatever their case', async () => {
    const send = stub_keyed_mcp_server();

    await send_mcp_request(
      {
        endpoint_url: server_url,
        session_id: 'the-session-of-this-request',
        protocol_version: '2025-06-18',
        headers: {
          host: 'another.host.test',
          'content-type': 'text/plain',
          ACCEPT: 'text/html',
          'mcp-session-id': 'a-session-chosen-by-an-admin',
          'MCP-PROTOCOL-VERSION': '1999-01-01',
          'X-Api-Key': good_api_key,
        },
      },
      { id: 1, method: 'initialize' },
    );

    const sent = send.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const sent_names = Object.keys(sent).map((name) => name.toLowerCase());
    expect(sent_names).toHaveLength(new Set(sent_names).size);
    expect(Object.fromEntries(new Headers(sent))).toEqual({
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
      'mcp-session-id': 'the-session-of-this-request',
      'x-api-key': good_api_key,
    });
  });
});
