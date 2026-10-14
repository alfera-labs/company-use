import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_nodes, resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import { revoke_connection } from '@coworker/core/db/queries/connection_management';
import { apps, connections } from '@coworker/core/db/schema';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { sync_mcp_server_tools } from '@runtime-platform/connections/mcp_tool_sync';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

const server_url = 'https://docs.acme.test/mcp';

function stub_open_server() {
  const send = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: 'AcmeDocs', version: '1.0.0' },
        },
      });
    }
    if (body.method === 'tools/list') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [
            { name: 'read_page', description: 'Read a doc', inputSchema: { type: 'object' } },
          ],
        },
      });
    }
    return new Response(null, { status: 202 });
  });
  vi.stubGlobal('fetch', send);
  return send;
}

afterEach(() => vi.unstubAllGlobals());

describe('adding an MCP server that needs no credential', () => {
  it('connects, imports tools, and leaves a connection someone can find', async () => {
    stub_open_server();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;
    expect(outcome.app_name).toBe('AcmeDocs');
    expect(outcome.tool_count).toBe(1);

    const connection = await db.query.connections.findFirst({
      where: eq(connections.workspace_id, bootstrap.workspace_id),
    });
    expect(connection).toMatchObject({
      connection_status: 'active',
      connection_name: 'AcmeDocs',
      auth_method_key: 'none',
    });
    expect(connection?.credentials).toBeNull();

    const mcp_nodes = (await list_nodes(db, { workspace_id: bootstrap.workspace_id })).filter(
      (node) => node.node_runtime === 'mcp_tool',
    );
    expect(mcp_nodes).toHaveLength(1);
    expect(mcp_nodes[0]?.connection_profile_key).toBe('mcp:acme:open');
    expect(mcp_nodes[0]?.metadata.required_connection).toBe(false);
  });

  it('sends a header the person added on every request, including the tool sync', async () => {
    const send = stub_open_server();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
      request_headers: { 'X-Api-Key': 'secret-api-key' },
    });

    const connection = await db.query.connections.findFirst({
      where: eq(connections.workspace_id, bootstrap.workspace_id),
    });
    expect(JSON.stringify(connection?.credentials)).not.toContain('secret-api-key');

    send.mockClear();
    await sync_mcp_server_tools({
      db,
      workspace_id: bootstrap.workspace_id,
      app_id: (connection as { app_id: string }).app_id,
      actor_id: bootstrap.user_id,
    });
    const sent = send.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-api-key'));
    expect(sent.length).toBeGreaterThan(0);
    expect(new Set(sent)).toEqual(new Set(['secret-api-key']));
  });

  it('honours None over what was detected, so a header-authenticated server connects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        if (new Headers(init?.headers).get('x-api-key') !== 'secret-api-key') {
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
              serverInfo: { name: 'KeyedDocs', version: '1.0.0' },
            },
          });
        }
        if (body.method === 'tools/list') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [
                { name: 'read_page', description: 'Read a doc', inputSchema: { type: 'object' } },
              ],
            },
          });
        }
        return new Response(null, { status: 202 });
      }),
    );
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
      authentication: 'none',
      request_headers: { 'X-Api-Key': 'secret-api-key' },
    });

    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;
    expect(outcome.tool_count).toBe(1);
  });

  it('stops its tools once the connection is revoked', async () => {
    stub_open_server();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    const tool = (await list_nodes(db, { workspace_id: bootstrap.workspace_id })).find(
      (node) => node.node_runtime === 'mcp_tool',
    );
    if (!tool) throw new Error('the open server imported no tools');

    const callable = async () =>
      (
        await resolve_catalog_tool(db, {
          workspace_id: bootstrap.workspace_id,
          node_key: tool.node_key,
        })
      ).compatibility;

    expect((await callable()).ok).toBe(true);

    const connection = await db.query.connections.findFirst({
      where: eq(connections.workspace_id, bootstrap.workspace_id),
    });
    await revoke_connection(db, {
      workspace_id: bootstrap.workspace_id,
      connection_id: (connection as { connection_id: string }).connection_id,
      actor_id: bootstrap.user_id,
    });

    expect((await callable()).ok).toBe(false);
  });

  it('gives a server added before connections existed one, on the next sync', async () => {
    stub_open_server();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
    });
    const app_id = (
      (await db.query.connections.findFirst({
        where: eq(connections.workspace_id, bootstrap.workspace_id),
      })) as { app_id: string }
    ).app_id;

    await db.delete(connections).where(eq(connections.workspace_id, bootstrap.workspace_id));

    await sync_mcp_server_tools({
      db,
      workspace_id: bootstrap.workspace_id,
      app_id,
      actor_id: bootstrap.user_id,
    });

    const healed = await db.query.connections.findFirst({
      where: eq(connections.workspace_id, bootstrap.workspace_id),
    });
    expect(healed).toMatchObject({ connection_status: 'active', auth_method_key: 'none' });

    const tool = (await list_nodes(db, { workspace_id: bootstrap.workspace_id })).find(
      (node) => node.node_runtime === 'mcp_tool',
    );
    if (!tool) throw new Error('the open server imported no tools');
    const resolved = await resolve_catalog_tool(db, {
      workspace_id: bootstrap.workspace_id,
      node_key: tool.node_key,
    });
    expect(resolved.compatibility.ok).toBe(true);
  });

  it('gives a server added before connections existed one, when someone adds it again', async () => {
    stub_open_server();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const add_once = () =>
      define_mcp_client_connection({
        db,
        workspace_id: bootstrap.workspace_id,
        actor_id: bootstrap.user_id,
        server_url,
        redirect_uri: 'https://app.example.test/connect/callback',
      });

    await add_once();
    await db.delete(connections).where(eq(connections.workspace_id, bootstrap.workspace_id));

    const outcome = await add_once();

    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;
    expect(outcome.tool_count).toBe(1);

    const healed = await db.query.connections.findFirst({
      where: eq(connections.workspace_id, bootstrap.workspace_id),
    });
    expect(healed).toMatchObject({ connection_status: 'active', auth_method_key: 'none' });
  });

  it('shows two servers that call themselves the same under the names the person typed, after a sync too', async () => {
    stub_open_server();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const add_named = (address: string, display_name: string) =>
      define_mcp_client_connection({
        db,
        workspace_id: bootstrap.workspace_id,
        actor_id: bootstrap.user_id,
        server_url: address,
        display_name,
        redirect_uri: 'https://app.example.test/connect/callback',
      });

    const first = await add_named('https://docs.acme.test/mcp', 'Docs for sales');
    const second = await add_named('https://docs.other.test/mcp', 'Docs for support');
    if (first.kind !== 'connected' || second.kind !== 'connected') {
      throw new Error('the two servers were not added');
    }
    for (const app_id of [first.app_id, second.app_id]) {
      await sync_mcp_server_tools({
        db,
        workspace_id: bootstrap.workspace_id,
        app_id,
        actor_id: bootstrap.user_id,
      });
    }

    const servers = await db.query.apps.findMany({
      where: eq(apps.workspace_id, bootstrap.workspace_id),
    });
    expect(servers.map((server) => server.app_display_name).sort()).toEqual([
      'Docs for sales',
      'Docs for support',
    ]);
  });

  it('says it is already connected when the same server is added twice', async () => {
    stub_open_server();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const add_once = () =>
      define_mcp_client_connection({
        db,
        workspace_id: bootstrap.workspace_id,
        actor_id: bootstrap.user_id,
        server_url,
        redirect_uri: 'https://app.example.test/connect/callback',
      });

    await add_once();
    const second = await add_once();

    expect(second.kind).toBe('refused');
    if (second.kind !== 'refused') return;
    expect(second.because).toContain('already connected');
  });
});
