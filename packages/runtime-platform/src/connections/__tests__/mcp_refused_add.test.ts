import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import {
  good_api_key,
  good_token,
  stub_keyed_mcp_server,
} from '@runtime-platform/connections/__tests__/mcp_keyed_server_stub';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

const server_url = 'https://notes.acme.test/mcp';

afterEach(() => vi.unstubAllGlobals());

type Credential = Partial<Parameters<typeof define_mcp_client_connection>[0]>;

async function create_workspace() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const in_this_workspace = bootstrap.workspace_id;
  return {
    add: (credential: Credential) =>
      define_mcp_client_connection({
        db,
        workspace_id: bootstrap.workspace_id,
        actor_id: bootstrap.user_id,
        server_url,
        redirect_uri: 'https://app.example.test/connect/callback',
        ...credential,
      }),
    read_what_is_left_behind: async () => ({
      connections: await db.query.connections.findMany({
        where: eq(connections.workspace_id, in_this_workspace),
      }),
      servers: await db.query.apps.findMany({ where: eq(apps.workspace_id, in_this_workspace) }),
      tools: await db.query.nodes.findMany({ where: eq(nodes.workspace_id, in_this_workspace) }),
    }),
  };
}

async function add_to_a_new_workspace(credential: Credential) {
  const workspace = await create_workspace();
  const outcome = await workspace.add(credential);
  return { outcome, left_behind: await workspace.read_what_is_left_behind() };
}

const with_a_key_in_a_header: Credential = {
  authentication: 'none',
  request_headers: { 'X-Api-Key': good_api_key },
};
const with_a_token: Credential = { access_token: good_token };

describe('an add the MCP server refuses', () => {
  it('leaves no connection and no server behind when the key in a header is wrong', async () => {
    stub_keyed_mcp_server();

    const { outcome, left_behind } = await add_to_a_new_workspace({
      authentication: 'none',
      request_headers: { 'X-Api-Key': 'a-wrong-key' },
    });

    expect(outcome).toEqual({
      kind: 'refused',
      because:
        'The server did not accept this key. Check the key and the header name: both must be exactly what the server asks for. If the server names no header, leave the header name empty, then add it again.',
    });
    expect(left_behind).toEqual({ connections: [], servers: [], tools: [] });
  });

  it('says a key is missing when the person gave none and the server asks for one', async () => {
    stub_keyed_mcp_server();

    const { outcome, left_behind } = await add_to_a_new_workspace({ authentication: 'none' });

    expect(outcome).toEqual({
      kind: 'refused',
      because:
        'This server asks for a key or a sign-in, and it was sent none. Give its key, or choose a sign-in, then add it again.',
    });
    expect(left_behind).toEqual({ connections: [], servers: [], tools: [] });
  });

  it('says where the key may belong when a key sent as a token is refused', async () => {
    stub_keyed_mcp_server();

    const { outcome } = await add_to_a_new_workspace({ access_token: 'a-wrong-token' });

    expect(outcome).toEqual({
      kind: 'refused',
      because:
        'The server did not accept this key. Check that the whole key was pasted. If the server wants the key under a header name, such as X-API-Key, fill in the header name, then add it again.',
    });
  });

  it('leaves nothing behind when the server takes the token and then fails to list its tools', async () => {
    const send = stub_keyed_mcp_server();
    const answer_as_before = send.getMockImplementation();
    send.mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.method === 'tools/list') return new Response('no', { status: 500 });
      return (await answer_as_before?.(input, init)) as Response;
    });

    const { outcome, left_behind } = await add_to_a_new_workspace({ access_token: good_token });

    expect(outcome).toEqual({
      kind: 'refused',
      because:
        'The MCP server failed on its own side (HTTP 500). Try again in a minute. If it fails again, the people who run the server must look at it.',
    });
    expect(left_behind).toEqual({ connections: [], servers: [], tools: [] });
  });

  it.each([
    ['a key in a header', with_a_key_in_a_header],
    ['a token', with_a_token],
  ])('leaves nothing behind when the server lists two tools with one name, added with %s', async (_how, credential) => {
    stub_keyed_mcp_server('KeyedNotes', [
      { name: 'read_note', description: 'Read a note', inputSchema: {} },
      { name: 'read_note', description: 'Read a note, again', inputSchema: {} },
    ]);

    const { outcome, left_behind } = await add_to_a_new_workspace(credential);

    expect(outcome).toEqual({
      kind: 'refused',
      because:
        'This server lists tools that Alfera cannot tell apart, so it was not added. Each tool of the server needs its own name.',
    });
    expect(left_behind).toEqual({ connections: [], servers: [], tools: [] });
  });

  it.each([
    ['a key in a header', with_a_key_in_a_header],
    ['a token', with_a_token],
  ])('leaves nothing behind when the database refuses a tool after the server and the connection were written, added with %s', async (_how, credential) => {
    stub_keyed_mcp_server('KeyedNotes', [
      { name: 'read_note', description: 'Read a note', inputSchema: {} },
      {
        name: 'write_note',
        description: 'A text the database cannot hold: \u0000',
        inputSchema: {},
      },
    ]);
    const workspace = await create_workspace();

    await expect(workspace.add(credential)).rejects.toThrow();

    expect(await workspace.read_what_is_left_behind()).toEqual({
      connections: [],
      servers: [],
      tools: [],
    });
  });
});
