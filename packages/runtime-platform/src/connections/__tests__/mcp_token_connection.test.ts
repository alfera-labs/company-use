import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_nodes } from '@coworker/core/db/queries/catalog';
import { create_workspace_mcp_catalog } from '@coworker/core/db/queries/mcp_catalog';
import { connections } from '@coworker/core/db/schema';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

const server_url = 'https://brain.acme.test/mcp';
const good_token = 'notebox_live_token';

const seen_authorization: (string | null)[] = [];

function stub_token_server(accepted_token: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen_authorization.push(headers.get('authorization'));

      if (headers.get('authorization') !== `Bearer ${accepted_token}`) {
        return new Response(JSON.stringify({ error: 'invalid_token' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }

      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            serverInfo: { name: 'NoteBox', version: '0.46.0' },
          },
        });
      }
      if (body.method === 'tools/list') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              { name: 'recall', description: 'Search the brain', inputSchema: { type: 'object' } },
              { name: 'remember', description: 'Write a memory', inputSchema: { type: 'object' } },
            ],
          },
        });
      }
      return new Response(null, { status: 202 });
    }),
  );
}

afterEach(() => {
  seen_authorization.length = 0;
  vi.unstubAllGlobals();
});

describe('adding an MCP server with a pasted token', () => {
  it('connects, names itself, imports tools, and stores the token encrypted', async () => {
    stub_token_server(good_token);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      access_token: good_token,
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;
    expect(outcome.app_name).toBe('NoteBox');
    expect(outcome.tool_count).toBe(2);

    const nodes = await list_nodes(db, { workspace_id: bootstrap.workspace_id });
    const mcp_nodes = nodes.filter((node) => node.node_runtime === 'mcp_tool');
    expect(mcp_nodes).toHaveLength(2);
    expect(mcp_nodes[0]?.connection_profile_key).toBe('mcp:acme:workspace_credentials');

    const connection = await db.query.connections.findFirst({
      where: eq(connections.workspace_id, bootstrap.workspace_id),
    });
    expect(connection?.connection_status).toBe('active');
    expect(JSON.stringify(connection?.credentials)).not.toContain(good_token);

    expect(seen_authorization.length).toBeGreaterThan(1);
    expect(new Set(seen_authorization)).toEqual(new Set([`Bearer ${good_token}`]));
  });

  it('accepts a token for a server already waiting on a sign-in it cannot finish', async () => {
    stub_token_server(good_token);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const stranded = await create_workspace_mcp_catalog(db, {
      workspace_id: bootstrap.workspace_id,
      server_key: 'acme',
      server_name: 'acme',
      transport_config: { type: 'streamable_http', url: server_url },
      auth_config: { type: 'mcp_connection' },
      tools: [],
      actor_id: bootstrap.user_id,
    });

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      access_token: good_token,
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;
    expect(outcome.app_id).toBe(stranded.app_id);
    expect(outcome.tool_count).toBe(2);

    const connection = await db.query.connections.findFirst({
      where: eq(connections.workspace_id, bootstrap.workspace_id),
    });
    expect(connection?.connection_status).toBe('active');
  });

  it('refuses a token the server rejects and writes nothing', async () => {
    stub_token_server(good_token);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      access_token: 'wrong_token',
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.because).toContain(
      'The server did not accept this key. Check that the whole key',
    );

    const nodes = await list_nodes(db, { workspace_id: bootstrap.workspace_id });
    expect(nodes.filter((node) => node.node_runtime === 'mcp_tool')).toHaveLength(0);
    const connection = await db.query.connections.findFirst({
      where: eq(connections.workspace_id, bootstrap.workspace_id),
    });
    expect(connection).toBeUndefined();
  });
});
