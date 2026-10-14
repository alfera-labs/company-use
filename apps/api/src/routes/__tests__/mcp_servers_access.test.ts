import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { workspace_members } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const server_on_the_network = 'http://192.168.1.20:8000/mcp';
const database_of_the_stack = 'http://172.18.0.2:5432/mcp';

vi.mock('node:os', async (import_original) => ({
  ...(await import_original<typeof import('node:os')>()),
  networkInterfaces: () => ({ eth0: [{ cidr: '172.18.0.3/16', internal: false }] }),
}));

async function answer_as_an_open_mcp_server(_input: string | URL | Request, init?: RequestInit) {
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (body.method === 'initialize') {
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        serverInfo: { name: 'Notes', version: '1.0.0' },
      },
    });
  }
  if (body.method === 'tools/list') {
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: { tools: [{ name: 'read_note', description: 'Read a note', inputSchema: {} }] },
    });
  }
  return new Response(null, { status: 202 });
}

let db: Database;
let app: ReturnType<typeof create_app>;
let user_id: string;

beforeEach(async () => {
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  user_id = bootstrap.user_id;
  app = create_app(db);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('administering MCP servers', () => {
  it.each(['member', 'viewer'])('refuses the %s role on every door', async (role) => {
    await set_member_role(role);

    const attempts = [
      await post('/v1/mcp-servers/inspect', { server_url: 'https://example.com/mcp' }),
      await post('/v1/mcp-servers', { server_url: 'https://example.com/mcp' }),
      await post('/v1/mcp-servers/app_1/sync'),
    ];

    for (const attempt of attempts) {
      expect(attempt.status).toBe(403);
      expect(attempt.body.error?.code).toBe('mcp_server_access_denied');
    }
    expect(await db.query.connections.findMany()).toHaveLength(0);
  });

  it.each([
    'member',
    'viewer',
  ])('refuses the %s role a server on a private address, even when the operator allowed those', async (role) => {
    vi.stubEnv('COWORKER_SELF_HOSTED', 'true');
    vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'open');
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    await set_member_role(role);

    const attempts = [
      await post('/v1/mcp-servers/inspect', { server_url: server_on_the_network }),
      await post('/v1/mcp-servers', { server_url: server_on_the_network }),
    ];

    for (const attempt of attempts) {
      expect(attempt.status).toBe(403);
      expect(attempt.body.error?.code).toBe('mcp_server_access_denied');
    }
    expect(send).not.toHaveBeenCalled();
    expect(await db.query.connections.findMany()).toHaveLength(0);
  });

  it.each([
    'owner',
    'admin',
  ])('lets the %s role inspect and add a server on a private address once the operator allowed those', async (role) => {
    vi.stubEnv('COWORKER_SELF_HOSTED', 'true');
    vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'open');
    const send = vi.fn(answer_as_an_open_mcp_server);
    vi.stubGlobal('fetch', send);
    await set_member_role(role);

    const inspected = await post('/v1/mcp-servers/inspect', { server_url: server_on_the_network });
    const added = await post('/v1/mcp-servers', {
      server_url: server_on_the_network,
      display_name: 'Notes on my network',
    });

    expect(inspected.status).toBe(200);
    expect(inspected.body.data).toMatchObject({
      endpoint_url: server_on_the_network,
      authentication: 'none',
      offers_sign_in: false,
    });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ kind: 'connected', app_name: 'Notes on my network' });
    expect(new Set(send.mock.calls.map(([url]) => String(url)))).toEqual(
      new Set([server_on_the_network]),
    );
  });

  it.each([
    ['the hosted product', {}, /^Alfera cannot reach a server on your own machine or network\./u],
    [
      'a self-hosted install with the switch off',
      { COWORKER_SELF_HOSTED: 'true' },
      /are switched off on this install\. To allow them, run \.\/alfera add local-mcp/u,
    ],
  ])('refuses an owner a server on a private address on %s, with the sentence to show', async (_install, settings, sentence) => {
    for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    const attempts = [
      await post('/v1/mcp-servers/inspect', { server_url: server_on_the_network }),
      await post('/v1/mcp-servers', { server_url: server_on_the_network }),
    ];

    for (const attempt of attempts) {
      expect(attempt.status).toBe(422);
      expect(attempt.body.error).toMatchObject({ code: 'mcp_server_refused' });
      expect(attempt.body.error?.message).toMatch(sentence);
    }
    expect(send).not.toHaveBeenCalled();
    expect(await db.query.connections.findMany()).toHaveLength(0);
  });

  it.each([
    'owner',
    'admin',
  ])("refuses the %s role an address on the API's own network, with the switch on", async (role) => {
    vi.stubEnv('COWORKER_SELF_HOSTED', 'true');
    vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'open');
    const send = vi.fn(answer_as_an_open_mcp_server);
    vi.stubGlobal('fetch', send);
    await set_member_role(role);

    const attempts = [
      await post('/v1/mcp-servers/inspect', { server_url: database_of_the_stack }),
      await post('/v1/mcp-servers', { server_url: database_of_the_stack }),
    ];

    for (const attempt of attempts) {
      expect(attempt.status).toBe(422);
      expect(attempt.body.error?.message).toBe(
        "That address is one of Alfera's own services, so give the address of your own MCP server instead.",
      );
    }
    expect(send).not.toHaveBeenCalled();
    expect(await db.query.connections.findMany()).toHaveLength(0);
  });

  it('refuses an owner a header that Alfera sets itself, with the sentence to show', async () => {
    vi.stubEnv('COWORKER_SELF_HOSTED', 'true');
    vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'open');
    const send = vi.fn(answer_as_an_open_mcp_server);
    vi.stubGlobal('fetch', send);

    const attempt = await post('/v1/mcp-servers', {
      server_url: server_on_the_network,
      request_headers: [{ name: 'Host', value: 'api:3001' }],
    });

    expect(attempt.status).toBe(422);
    expect(attempt.body.error?.message).toBe(
      'Alfera sets the Host header itself. Take it out of the additional request headers.',
    );
    expect(send).not.toHaveBeenCalled();
    expect(await db.query.connections.findMany()).toHaveLength(0);
  });

  it('lets an admin past the gate', async () => {
    await set_member_role('admin');

    const attempt = await post('/v1/mcp-servers/app_1/sync');

    expect(attempt.status).not.toBe(403);
  });
});

function set_member_role(role: string) {
  return db
    .update(workspace_members)
    .set({ member_role: role })
    .where(eq(workspace_members.user_id, user_id));
}

async function post(path: string, body?: unknown) {
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      data?: Record<string, unknown>;
      error?: { code: string; message?: string };
    },
  };
}
