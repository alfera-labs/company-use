import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { workspace_members } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const server_on_the_network = 'http://192.168.1.20:8000/mcp';
const server_on_the_internet = 'https://docs.acme.test/mcp';
const return_address = 'http://localhost:3000/connect/callback';

vi.mock('node:dns/promises', async (import_original) => ({
  ...(await import_original<typeof import('node:dns/promises')>()),
  lookup: async (host: string) => [{ address: /^[\d.]+$/.test(host) ? host : '93.184.216.34' }],
}));
vi.mock('node:os', async (import_original) => ({
  ...(await import_original<typeof import('node:os')>()),
  networkInterfaces: () => ({ eth0: [{ cidr: '172.18.0.3/16', internal: false }] }),
}));

type Sent = { headers: Headers; method: string };

function start_mcp_server(tool_names: string[]) {
  const server = { tool_names, is_running: true, sent: [] as Sent[] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_address: string | URL | Request, init?: RequestInit) => {
      if (!server.is_running) throw new Error('Unable to connect.');
      const body = JSON.parse(String(init?.body ?? '{}'));
      server.sent.push({ headers: new Headers(init?.headers), method: body.method });
      if (body.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            serverInfo: { name: 'Kettle notes', version: '1.0.0' },
          },
        });
      }
      if (body.method === 'tools/list') {
        const tools = server.tool_names.map((name) => ({ name, inputSchema: {} }));
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools } });
      }
      return new Response(null, { status: 202 });
    }),
  );
  return server;
}

let db: Database;
let app: ReturnType<typeof create_app>;
let user_id: string;

beforeEach(async () => {
  db = await create_test_database();
  user_id = (await bootstrap_default_workspace(db)).user_id;
  app = create_app(db);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function open_private_servers() {
  vi.stubEnv('COWORKER_SELF_HOSTED', 'true');
  vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'open');
}

describe('Reconnect on an MCP server that has no sign-in to renew', () => {
  it('asks the server for its tools again, and starts no setup', async () => {
    open_private_servers();
    const server = start_mcp_server(['read_note']);
    const connection_id = await add_server({ server_url: server_on_the_network });
    server.tool_names = ['read_note', 'write_note'];

    const reconnected = await reconnect(connection_id);

    expect(reconnected.status).toBe(200);
    expect(reconnected.body.data).toMatchObject({
      tools_read_again: { tool_count: 2 },
      start_url: null,
      connection: { connection_id, connection_status: 'active' },
    });
    expect(await why_the_listed_connection_cannot_work()).toBeNull();
    expect(
      (await db.query.nodes.findMany()).filter((node) => node.provider_key === 'mcp'),
    ).toHaveLength(2);
  });

  it('sends the stored key again for a server that takes a key, and leaves it connected', async () => {
    open_private_servers();
    const server = start_mcp_server(['read_note']);
    const connection_id = await add_server({
      server_url: server_on_the_network,
      access_token: 'key-of-the-server',
    });
    server.sent.length = 0;

    const reconnected = await reconnect(connection_id);

    expect(reconnected.status).toBe(200);
    expect(reconnected.body.data).toMatchObject({
      tools_read_again: { tool_count: 1 },
      connection: { connection_status: 'active' },
    });
    expect(server.sent.map((request) => request.headers.get('authorization'))).toEqual(
      server.sent.map(() => 'Bearer key-of-the-server'),
    );
    expect(server.sent.length).toBeGreaterThan(0);
  });

  it('says in one sentence that the server does not answer, and the connection stops reading as one that works', async () => {
    open_private_servers();
    const server = start_mcp_server(['read_note']);
    const connection_id = await add_server({ server_url: server_on_the_network });
    server.is_running = false;

    const refused = await reconnect(connection_id);

    const sentence =
      'Alfera could not connect to that address. Check the spelling of the address and that the server is running, then try again.';
    expect(refused.status).toBe(422);
    expect(refused.body.error).toEqual(expect.objectContaining({ message: sentence }));
    const cannot_work_now = {
      status_label: 'Not working',
      sentence: `The last time Alfera asked this server for its tools, it failed. ${sentence}`,
    };
    expect((await get(`/v1/connections/${connection_id}`)).body.data).toMatchObject({
      connection_status: 'active',
      cannot_work_now,
    });
    expect(await why_the_listed_connection_cannot_work()).toEqual(cannot_work_now);

    server.is_running = true;
    expect((await reconnect(connection_id)).status).toBe(200);
    expect(await why_the_listed_connection_cannot_work()).toBeNull();
  });

  it('reads the same on the hosted product for a server on the internet', async () => {
    const server = start_mcp_server(['read_page']);
    const connection_id = await add_server({ server_url: server_on_the_internet });
    expect(await why_the_listed_connection_cannot_work()).toBeNull();

    server.is_running = false;

    expect((await reconnect(connection_id)).status).toBe(422);
    expect(await why_the_listed_connection_cannot_work()).toMatchObject({
      status_label: 'Not working',
    });
  });

  it('refuses a member with a sentence, and asks the server nothing', async () => {
    open_private_servers();
    const server = start_mcp_server(['read_note']);
    const connection_id = await add_server({ server_url: server_on_the_network });
    server.sent.length = 0;
    await db
      .update(workspace_members)
      .set({ member_role: 'member' })
      .where(eq(workspace_members.user_id, user_id));

    const refused = await reconnect(connection_id);

    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toBe(
      'Only an owner or an admin can have Alfera read the tools of an MCP server again. Ask one of them to select Reconnect.',
    );
    expect(server.sent).toHaveLength(0);
  });
});

describe('a connected server on a private address after the operator switched those off', () => {
  it('reads as switched off, with the command that switches it on again', async () => {
    open_private_servers();
    const server = start_mcp_server(['read_note']);
    const connection_id = await add_server({ server_url: server_on_the_network });
    expect(await why_the_listed_connection_cannot_work()).toBeNull();

    vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'closed');
    server.sent.length = 0;

    const cannot_work_now = {
      status_label: 'Switched off',
      sentence:
        'Servers on your own machine or network are switched off on this install. To switch them on again, run ./alfera add local-mcp on the machine that runs Alfera.',
    };
    expect(await why_the_listed_connection_cannot_work()).toEqual(cannot_work_now);
    expect((await get(`/v1/connections/${connection_id}`)).body.data).toMatchObject({
      cannot_work_now,
    });

    const refused = await reconnect(connection_id);
    expect(refused.status).toBe(422);
    expect(refused.body.error?.message).toBe(cannot_work_now.sentence);
    expect(server.sent).toHaveLength(0);

    vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'open');
    expect(await why_the_listed_connection_cannot_work()).toBeNull();
  });
});

async function add_server(body: { server_url: string; access_token?: string }) {
  const added = await post('/v1/mcp-servers', body);
  expect(added.body.data, added.body.error?.message).toMatchObject({ kind: 'connected' });
  const [connection] = await db.query.connections.findMany();
  if (!connection) throw new Error('the server was added with no connection');
  return connection.connection_id;
}

function reconnect(connection_id: string) {
  return post(`/v1/connections/${connection_id}/reconnect`, { redirect_uri: return_address });
}

async function why_the_listed_connection_cannot_work() {
  const listed = z
    .array(z.object({ cannot_work_now: z.unknown().optional() }))
    .parse((await get('/v1/connections')).body.data);
  expect(listed).toHaveLength(1);
  return listed[0]?.cannot_work_now ?? null;
}

async function get(path: string) {
  return read(await app.request(path));
}

async function post(path: string, body: unknown) {
  return read(
    await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function read(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as {
      data?: Record<string, unknown>;
      error?: { code: string; message?: string };
    },
  };
}
