import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_nodes, resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import { revoke_connection } from '@coworker/core/db/queries/connection_management';
import { connections } from '@coworker/core/db/schema';
import {
  good_api_key,
  good_token,
  stub_keyed_mcp_server,
} from '@runtime-platform/connections/__tests__/mcp_keyed_server_stub';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { build_mcp_authorization_headers } from '@runtime-platform/tools/mcp/mcp_credential_headers';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

const server_url = 'https://notes.acme.test/mcp';

afterEach(() => vi.unstubAllGlobals());

type Workspace = { db: Database; workspace_id: string; user_id: string };

async function create_workspace(): Promise<Workspace> {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return { db, workspace_id: bootstrap.workspace_id, user_id: bootstrap.user_id };
}

function add_server(
  workspace: Workspace,
  credential: Partial<Parameters<typeof define_mcp_client_connection>[0]>,
) {
  return define_mcp_client_connection({
    db: workspace.db,
    workspace_id: workspace.workspace_id,
    actor_id: workspace.user_id,
    server_url,
    redirect_uri: 'https://app.example.test/connect/callback',
    ...credential,
  });
}

function list_active_connections(workspace: Workspace) {
  return workspace.db.query.connections.findMany({
    where: and(
      eq(connections.workspace_id, workspace.workspace_id),
      eq(connections.connection_status, 'active'),
    ),
  });
}

async function remove_the_one_connection(workspace: Workspace) {
  const [connection] = await list_active_connections(workspace);
  await revoke_connection(workspace.db, {
    workspace_id: workspace.workspace_id,
    connection_id: (connection as { connection_id: string }).connection_id,
    actor_id: workspace.user_id,
  });
}

async function resolve_the_one_tool(workspace: Workspace) {
  const tool = (await list_nodes(workspace.db, { workspace_id: workspace.workspace_id })).find(
    (node) => node.node_runtime === 'mcp_tool',
  );
  if (!tool) throw new Error('the server imported no tools');
  return resolve_catalog_tool(workspace.db, {
    workspace_id: workspace.workspace_id,
    node_key: tool.node_key,
  });
}

describe('adding the same MCP server again with another kind of credential', () => {
  it('gives a connection its tools can run with: a key in a header first, then a token', async () => {
    stub_keyed_mcp_server();
    const workspace = await create_workspace();
    await add_server(workspace, {
      authentication: 'none',
      request_headers: { 'X-Api-Key': good_api_key },
    });
    await remove_the_one_connection(workspace);

    const second_add = await add_server(workspace, { access_token: good_token });

    expect(second_add.kind).toBe('connected');
    expect(await list_active_connections(workspace)).toHaveLength(1);
    const resolved = await resolve_the_one_tool(workspace);
    expect(resolved.compatibility).toEqual({ ok: true });
    expect(
      build_mcp_authorization_headers(
        { app_name: resolved.tool?.app_name ?? '', connection_profile_key: 'set' },
        resolved.connection,
      ),
    ).toEqual({ ok: true, value: { Authorization: `Bearer ${good_token}` } });
  });

  it('keeps a token connection its tools can run with: a token first, then a token again', async () => {
    stub_keyed_mcp_server();
    const workspace = await create_workspace();
    await add_server(workspace, { access_token: good_token });

    const second_add = await add_server(workspace, { access_token: good_token });

    expect(second_add.kind).toBe('connected');
    expect((await resolve_the_one_tool(workspace)).compatibility).toEqual({ ok: true });
  });

  it('gives a connection its tools can run with: a token first, then a key under a named header', async () => {
    stub_keyed_mcp_server();
    const workspace = await create_workspace();
    await add_server(workspace, { access_token: good_token });
    await remove_the_one_connection(workspace);

    const second_add = await add_server(workspace, {
      authentication: 'none',
      request_headers: { 'X-Api-Key': good_api_key },
    });

    expect(second_add).toMatchObject({ kind: 'connected', tool_count: 1 });
    expect(await list_active_connections(workspace)).toHaveLength(1);
    const resolved = await resolve_the_one_tool(workspace);
    expect(resolved.compatibility).toEqual({ ok: true });
    expect(
      build_mcp_authorization_headers(
        {
          app_name: 'KeyedNotes',
          connection_profile_key: resolved.tool?.connection_profile_key ?? null,
        },
        resolved.connection,
      ),
    ).toEqual({ ok: true, value: { 'X-Api-Key': good_api_key } });
  });

  it('connects again with the same key under a named header after the connection was removed', async () => {
    stub_keyed_mcp_server();
    const workspace = await create_workspace();
    const with_the_key = {
      authentication: 'none' as const,
      request_headers: { 'X-Api-Key': good_api_key },
    };
    await add_server(workspace, with_the_key);
    await remove_the_one_connection(workspace);

    const second_add = await add_server(workspace, with_the_key);

    expect(second_add).toMatchObject({ kind: 'connected', tool_count: 1 });
    expect(await list_active_connections(workspace)).toHaveLength(1);
    expect((await resolve_the_one_tool(workspace)).compatibility).toEqual({ ok: true });
  });

  it('changes nothing when the second add gives a wrong key', async () => {
    stub_keyed_mcp_server();
    const workspace = await create_workspace();
    await add_server(workspace, { access_token: good_token });
    await remove_the_one_connection(workspace);
    const before = await workspace.db.query.apps.findMany();

    const second_add = await add_server(workspace, {
      authentication: 'none',
      request_headers: { 'X-Api-Key': 'a-wrong-key' },
    });

    expect(second_add).toEqual({
      kind: 'refused',
      because: expect.stringContaining('Check the key and the header name'),
    });
    expect(await workspace.db.query.connections.findMany()).toHaveLength(1);
    expect(await list_active_connections(workspace)).toHaveLength(0);
    expect(
      (await workspace.db.query.apps.findMany()).map((app) => app.metadata.provider_configs),
    ).toEqual(before.map((app) => app.metadata.provider_configs));
  });

  it('refuses a key in a header when the server is already connected with a token', async () => {
    stub_keyed_mcp_server();
    const workspace = await create_workspace();
    await add_server(workspace, { access_token: good_token });

    const second_add = await add_server(workspace, {
      authentication: 'none',
      request_headers: { 'X-Api-Key': good_api_key },
    });

    expect(second_add).toEqual({
      kind: 'refused',
      because:
        'KeyedNotes is already connected. Remove that connection first, then add the server again.',
    });
    expect(await list_active_connections(workspace)).toHaveLength(1);
  });
});
