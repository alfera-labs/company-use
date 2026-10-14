import { create_app } from '@api/app';
import { seed_connector_catalog } from '@coworker/connectors';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { pending_connection_setup_expiry_ms } from '@coworker/core/db/queries/connection_management';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { apps, connections, workspace_members } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@coworker/runtime-platform';
import { create_id, id_prefixes } from '@coworker/shared';
import { build_connector_connection } from '@runtime-platform/tools/connector_executor';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PrimaryMemberChannel = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members: number | null;
} | null;

const runtime_platform = vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'test-app-catalogue-key';
  return {
    find_primary_member_channel: vi.fn<() => Promise<PrimaryMemberChannel>>(async () => null),
    probe_slack_connection_liveness: vi.fn<() => Promise<'alive' | 'dead' | 'unknown'>>(
      async () => 'alive',
    ),
  };
});

const proxy_secret = 'local-development-internal-api-secret';

function identity_headers(input: {
  organization_id: string;
  provider_user_id: string;
  email: string;
}) {
  return {
    'Content-Type': 'application/json',
    'x-coworker-api-secret': proxy_secret,
    'x-coworker-auth-provider': 'workos',
    'x-coworker-auth-user-id': input.provider_user_id,
    'x-coworker-auth-organization-id': input.organization_id,
    'x-coworker-auth-email': input.email,
  };
}

const provider_api = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

vi.mock('@coworker/runtime-platform', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/runtime-platform')>();
  return {
    ...actual,
    find_primary_member_channel: runtime_platform.find_primary_member_channel,
    probe_slack_connection_liveness: runtime_platform.probe_slack_connection_liveness,
  };
});

async function read_authorization_url(app: ReturnType<typeof create_app>, start_url: string) {
  const start = new URL(start_url);
  const response = await app.request(
    `/v1/connections/setup/start?connection_id=${start.searchParams.get('connection_id')}` +
      `&setup_token=${start.searchParams.get('setup_token')}`,
  );
  const data = (await response.json()).data;
  return new URL(data.setup_url);
}

describe('connection management api routes', () => {
  beforeEach(() => {
    runtime_platform.find_primary_member_channel.mockReset();
    runtime_platform.find_primary_member_channel.mockResolvedValue(null);
    provider_api.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TEST_OAUTH_CLIENT_SECRET;
    delete process.env.SLACK_CLIENT_ID;
    delete process.env.SLACK_CLIENT_SECRET;
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CONNECTOR_NOTION_CLIENT_ID;
    delete process.env.CONNECTOR_NOTION_CLIENT_SECRET;
  });

  it('refuses a new connection to a held connector app', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    await seed_connector_catalog(db);
    const gmail_app = await db.query.apps.findFirst({
      where: (table, { eq }) => eq(table.app_name, 'gmail'),
    });
    if (!gmail_app) throw new Error('Gmail connector app was not seeded');

    const response = await create_app(db).request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: gmail_app.app_id }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.message).toBe("Google has not approved this app's scopes yet.");
    expect(await db.query.connections.findFirst()).toBeUndefined();
  });

  it('does not finalize Composio provider webhooks after setup expiry', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_api_test_app(db);
    const app = create_app(db);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'composio' }),
    });
    const created = (await create_response.json()).data;
    const connection_id = created.connection.connection_id;
    const stored_pending_connection = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, connection_id),
    });
    const setup_state = stored_pending_connection?.setup_state as Record<string, unknown>;
    await db
      .update(connections)
      .set({
        created_time: new Date(Date.now() - pending_connection_setup_expiry_ms),
        setup_state: {
          ...setup_state,
          setup_started_time: new Date(
            Date.now() - pending_connection_setup_expiry_ms,
          ).toISOString(),
        },
      })
      .where(eq(connections.connection_id, connection_id));

    const webhook_response = await app.request(
      `/v1/connections/providers/composio/webhook?connection_id=${connection_id}&provider_webhook_token=${setup_state.provider_webhook_token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'CONNECTION_SUCCESS',
          account: {
            id: 'apn_expired',
            name: 'expired@example.com',
            external_id: setup_state.external_user_key,
            healthy: true,
            dead: null,
            app: {
              id: 'app_gmail',
              name_slug: 'gmail',
              name: 'Gmail',
            },
            created_at: '2026-06-04T11:02:07.000Z',
            updated_at: '2026-06-04T11:02:07.000Z',
          },
        }),
      },
    );

    const body = await webhook_response.json();
    const stored_connection = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, connection_id),
    });
    expect(webhook_response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: 'validation_error',
      message: 'Connection is not pending setup',
    });
    expect(stored_connection).toMatchObject({
      connection_status: 'expired',
      health_status: 'unhealthy',
      setup_state: expect.objectContaining({
        expired_reason: 'setup_timed_out',
      }),
    });
    expect(stored_connection?.setup_state).not.toHaveProperty('provider_webhook_token');
    expect(stored_connection?.external_account_id).toBeNull();
  });

  it('rejects invalid public completion setup tokens before provider lookup', async () => {
    vi.stubGlobal('fetch', provider_api);
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_api_test_app(db);
    const app = create_app(db);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'composio' }),
    });
    const created = (await create_response.json()).data;
    const complete_response = await app.request(
      `/v1/connections/setup/complete?connection_id=${created.connection.connection_id}&setup_token=wrong-token`,
      { method: 'POST' },
    );
    const body = await complete_response.json();

    expect(complete_response.status).toBe(401);
    expect(body.error).toMatchObject({
      code: 'invalid_connection_setup_token',
      message: 'Invalid connection setup token',
    });
    expect(provider_api).not.toHaveBeenCalled();
  });

  it('rejects invalid public setup tokens', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_api_test_app(db);
    const app = create_app(db);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'composio' }),
    });
    const created = (await create_response.json()).data;
    const start_response = await app.request(
      `/v1/connections/setup/start?connection_id=${created.connection.connection_id}&setup_token=wrong-token`,
    );
    const body = await start_response.json();

    expect(start_response.status).toBe(401);
    expect(body.error).toMatchObject({
      code: 'invalid_connection_setup_token',
      message: 'Invalid connection setup token',
    });
  });

  it('shows expired public setup links without opening the provider', async () => {
    vi.stubGlobal('fetch', provider_api);
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_api_test_app(db);
    const app = create_app(db);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'composio' }),
    });
    const created = (await create_response.json()).data;
    const connection_id = created.connection.connection_id;
    const stored_pending_connection = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, connection_id),
    });
    const setup_state = stored_pending_connection?.setup_state as Record<string, unknown>;
    await db
      .update(connections)
      .set({
        created_time: new Date(Date.now() - pending_connection_setup_expiry_ms),
        setup_state: {
          ...setup_state,
          setup_started_time: new Date(
            Date.now() - pending_connection_setup_expiry_ms,
          ).toISOString(),
        },
      })
      .where(eq(connections.connection_id, connection_id));

    const start_response = await app.request(
      `/v1/connections/setup/start?connection_id=${connection_id}&setup_token=${setup_state.setup_token}`,
    );
    const body = await start_response.json();
    const stored_connection = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, connection_id),
    });

    expect(start_response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: 'validation_error',
      message: 'Connection setup expired',
    });
    expect(provider_api).not.toHaveBeenCalled();
    expect(stored_connection).toMatchObject({
      connection_status: 'expired',
      health_status: 'unhealthy',
      setup_state: expect.objectContaining({
        expired_reason: 'setup_timed_out',
      }),
    });
  });

  it('reads and updates agent enabled nodes through public routes', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const enabled_nodes = [
      {
        node_key: 'runtime-search_context-1',
        provider_key: 'native',
        status: 'enabled',
        connection_selector: { strategy: 'no_connection_required' },
        input_defaults: {},
        approval_policy_override: null,
      },
    ];

    const put_response = await app.request(`/v1/agents/${bootstrap.agent_id}/enabled-nodes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled_nodes }),
    });
    const get_response = await app.request(`/v1/agents/${bootstrap.agent_id}/enabled-nodes`);

    expect(put_response.status).toBe(200);
    expect((await get_response.json()).data).toMatchObject(enabled_nodes);
  });

  it('rejects invalid agent enabled nodes without persisting them', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const invalid_enabled_nodes = [
      {
        node_key: 'runtime-search_context-1',
        status: 'enabled',
        connection_selector: { strategy: 'no_connection_required' },
      },
      {
        node_key: 'runtime-search_context-1',
        provider_key: 'native',
        status: 'enabled',
        connection_selector: { strategy: 'specific_connection' },
      },
    ];

    for (const invalid_enabled_node of invalid_enabled_nodes) {
      const response = await app.request(`/v1/agents/${bootstrap.agent_id}/enabled-nodes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled_nodes: [invalid_enabled_node] }),
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toMatchObject({
        code: 'validation_error',
        message: 'Request body failed validation',
      });
    }

    const get_response = await app.request(`/v1/agents/${bootstrap.agent_id}/enabled-nodes`);
    expect(get_response.status).toBe(200);
    expect((await get_response.json()).data).toEqual([]);
  });

  it('lets teammates use shared connections without letting them manage or delete them', async () => {
    const { app, connection_id, owner_headers, teammate_headers } =
      await create_private_connection_test_context();
    const share_response = await app.request(`/v1/connections/${connection_id}`, {
      method: 'PATCH',
      headers: owner_headers,
      body: JSON.stringify({ access_type: 'shared' }),
    });
    const list_response = await app.request('/v1/connections', { headers: teammate_headers });
    const teammate_connection = (await list_response.json()).data.find(
      (connection: { connection_id: string }) => connection.connection_id === connection_id,
    );
    const rename_response = await app.request(`/v1/connections/${connection_id}`, {
      method: 'PATCH',
      headers: teammate_headers,
      body: JSON.stringify({ connection_name: 'Taken over' }),
    });
    const revoke_response = await app.request(`/v1/connections/${connection_id}/revoke`, {
      method: 'POST',
      headers: teammate_headers,
    });

    expect(share_response.status).toBe(200);
    expect(list_response.status).toBe(200);
    expect(teammate_connection.permissions).toEqual({
      can_use: true,
      can_manage: false,
      can_delete: false,
    });
    expect(rename_response.status).toBe(403);
    expect(revoke_response.status).toBe(403);
  });

  it('shares a private connection without erasing existing permissions', async () => {
    const { app, connection_id, owner, owner_headers, teammate, teammate_headers } =
      await create_private_connection_test_context();
    const members_response = await app.request('/v1/workspace/members', {
      headers: owner_headers,
    });
    const workspace_members = (await members_response.json()).data.members as Array<{
      user_id: string;
    }>;
    const hidden_connections_response = await app.request('/v1/connections', {
      headers: teammate_headers,
    });
    const add_teammate_response = await app.request(
      `/v1/connections/${connection_id}/access/members`,
      {
        method: 'POST',
        headers: owner_headers,
        body: JSON.stringify({ user_id: teammate.user_id }),
      },
    );
    const visible_connections_response = await app.request('/v1/connections', {
      headers: teammate_headers,
    });
    const update_owner_response = await app.request(
      `/v1/connections/${connection_id}/access/members`,
      {
        method: 'POST',
        headers: owner_headers,
        body: JSON.stringify({ user_id: owner.user_id, can_edit_tools: true }),
      },
    );
    const unchanged_access_response = await app.request(`/v1/connections/${connection_id}`, {
      method: 'PATCH',
      headers: owner_headers,
      body: JSON.stringify({ access_type: 'restricted' }),
    });
    const remove_teammate_response = await app.request(
      `/v1/connections/${connection_id}/access/members/${teammate.user_id}`,
      { method: 'DELETE', headers: owner_headers },
    );

    const updated = (await update_owner_response.json()).data;
    const unchanged = (await unchanged_access_response.json()).data;
    const after_removal = (await remove_teammate_response.json()).data;
    const hidden_connections = (await hidden_connections_response.json()).data;
    const visible_connections = (await visible_connections_response.json()).data;
    const owner_access = updated.connection_config.access.allowed_users.find(
      (member: { user_id: string }) => member.user_id === owner.user_id,
    );

    expect(members_response.status).toBe(200);
    expect(workspace_members.map((member) => member.user_id)).toEqual(
      expect.arrayContaining([owner.user_id, teammate.user_id]),
    );
    expect(add_teammate_response.status).toBe(200);
    expect(hidden_connections).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ connection_id })]),
    );
    expect(visible_connections).toEqual(
      expect.arrayContaining([expect.objectContaining({ connection_id })]),
    );
    expect(owner_access).toMatchObject({
      user_id: owner.user_id,
      can_delete: true,
      can_edit_tools: true,
    });
    expect(unchanged.connection_config.access.allowed_users).toHaveLength(2);
    expect(remove_teammate_response.status).toBe(200);
    expect(after_removal.connection_config.access.allowed_users).toEqual([
      expect.objectContaining({ user_id: owner.user_id }),
    ]);
  });

  it('rejects foreign members and raw private-access config writes', async () => {
    const { app, connection_id, owner_headers } = await create_private_connection_test_context();
    const outsider_response = await app.request(`/v1/connections/${connection_id}/access/members`, {
      method: 'POST',
      headers: owner_headers,
      body: JSON.stringify({ user_id: 'user_outside_workspace' }),
    });
    const raw_config_response = await app.request(`/v1/connections/${connection_id}`, {
      method: 'PATCH',
      headers: owner_headers,
      body: JSON.stringify({ connection_config: { connection_access_type: 'shared' } }),
    });

    expect(outsider_response.status).toBe(422);
    expect(raw_config_response.status).toBe(422);
    expect((await raw_config_response.json()).error.code).toBe('validation_error');
  });

  it('blocks use-only members from managing a private connection', async () => {
    const { app, connection_id, owner_headers, teammate, teammate_headers } =
      await create_private_connection_test_context();
    const hidden_connection_response = await app.request(`/v1/connections/${connection_id}`, {
      headers: teammate_headers,
    });
    await app.request(`/v1/connections/${connection_id}/access/members`, {
      method: 'POST',
      headers: owner_headers,
      body: JSON.stringify({ user_id: teammate.user_id }),
    });
    const denied_rename_response = await app.request(`/v1/connections/${connection_id}`, {
      method: 'PATCH',
      headers: teammate_headers,
      body: JSON.stringify({ connection_name: 'Taken over' }),
    });
    const denied_reconnect_response = await app.request(
      `/v1/connections/${connection_id}/reconnect`,
      { method: 'POST', headers: teammate_headers, body: JSON.stringify({}) },
    );
    const denied_check_response = await app.request(`/v1/connections/${connection_id}/check`, {
      method: 'POST',
      headers: teammate_headers,
    });
    const denied_complete_response = await app.request(
      `/v1/connections/${connection_id}/complete`,
      { method: 'POST', headers: teammate_headers },
    );

    expect(hidden_connection_response.status).toBe(404);
    expect(denied_rename_response.status).toBe(403);
    expect(denied_reconnect_response.status).toBe(403);
    expect(denied_check_response.status).toBe(403);
    expect(denied_complete_response.status).toBe(403);
  });

  it('lets a workspace admin manage and delete a shared connection another member made', async () => {
    const { app, db, connection_id, owner_headers, teammate, teammate_headers } =
      await create_private_connection_test_context();
    await app.request(`/v1/connections/${connection_id}`, {
      method: 'PATCH',
      headers: owner_headers,
      body: JSON.stringify({ access_type: 'shared' }),
    });
    await db
      .update(workspace_members)
      .set({ member_role: 'admin' })
      .where(eq(workspace_members.user_id, teammate.user_id));
    const list_response = await app.request('/v1/connections', { headers: teammate_headers });
    const admin_connection = (await list_response.json()).data.find(
      (connection: { connection_id: string }) => connection.connection_id === connection_id,
    );
    const rename_response = await app.request(`/v1/connections/${connection_id}`, {
      method: 'PATCH',
      headers: teammate_headers,
      body: JSON.stringify({ connection_name: 'Renamed by an admin' }),
    });

    expect(admin_connection.permissions).toEqual({
      can_use: true,
      can_manage: true,
      can_delete: true,
    });
    expect(rename_response.status).toBe(200);
  });

  it('adds a person to a connection whose named people can only use it', async () => {
    const { app, connection_id, owner, owner_headers, teammate } =
      await create_private_connection_test_context();
    const only_the_owner_can_use_it = await app.request(`/v1/access/connection/${connection_id}`, {
      method: 'PUT',
      headers: owner_headers,
      body: JSON.stringify({
        shared_with_everyone_in_the_workspace: false,
        shared_with: [{ person: owner.user_id, can: 'use' }],
      }),
    });

    const add_response = await app.request(`/v1/connections/${connection_id}/access/members`, {
      method: 'POST',
      headers: owner_headers,
      body: JSON.stringify({ user_id: teammate.user_id }),
    });
    const sharing_response = await app.request(`/v1/access/connection/${connection_id}`, {
      headers: owner_headers,
    });

    expect(only_the_owner_can_use_it.status).toBe(200);
    expect(add_response.status).toBe(200);
    expect((await sharing_response.json()).data.shared_with).toEqual([
      { person: owner.user_id, can: 'use' },
      { person: teammate.user_id, can: 'use' },
    ]);
  });

  it('never locks an admin out of a connection shared with other people only', async () => {
    const { app, db, connection_id, owner, teammate, teammate_headers } =
      await create_private_connection_test_context();
    const set_member_role = (member_role: string) =>
      db
        .update(workspace_members)
        .set({ member_role })
        .where(eq(workspace_members.user_id, teammate.user_id));
    const find_in_list = async () => {
      const list_response = await app.request('/v1/connections', { headers: teammate_headers });
      return (await list_response.json()).data.find(
        (connection: { connection_id: string }) => connection.connection_id === connection_id,
      );
    };
    const rename = () =>
      app.request(`/v1/connections/${connection_id}`, {
        method: 'PATCH',
        headers: teammate_headers,
        body: JSON.stringify({ connection_name: 'Renamed by an admin' }),
      });

    await set_member_role('admin');
    const share_response = await app.request(`/v1/access/connection/${connection_id}`, {
      method: 'PUT',
      headers: teammate_headers,
      body: JSON.stringify({
        shared_with_everyone_in_the_workspace: false,
        shared_with: [{ person: owner.user_id, can: 'use' }],
      }),
    });
    const admin_connection = await find_in_list();
    const admin_detail_response = await app.request(`/v1/connections/${connection_id}`, {
      headers: teammate_headers,
    });
    const admin_rename_response = await rename();

    await set_member_role('member');
    const member_connection = await find_in_list();
    const member_detail_response = await app.request(`/v1/connections/${connection_id}`, {
      headers: teammate_headers,
    });
    const member_rename_response = await rename();

    expect(share_response.status).toBe(200);
    expect(admin_connection.permissions).toEqual({
      can_use: false,
      can_manage: true,
      can_delete: true,
    });
    expect(admin_detail_response.status).toBe(200);
    expect(admin_rename_response.status).toBe(200);
    expect(member_connection).toBeUndefined();
    expect(member_detail_response.status).toBe(404);
    expect(member_rename_response.status).toBe(403);
  });

  it('records why the token exchange failed instead of answering with a 500', async () => {
    process.env.TEST_OAUTH_CLIENT_SECRET = 'client_secret_test';
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'test-credential-key';
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_oauth_test_app(db);
    const app = create_app(db);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'invalid_grant', error_description: 'Authorization code expired' },
          { status: 400 },
        ),
      ),
    );

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'native' }),
    });
    const created = (await create_response.json()).data;
    const authorization_url = await read_authorization_url(app, created.start_url);
    const state = authorization_url.searchParams.get('state');

    const callback_response = await app.request(
      `/v1/connections/oauth/callback?state=${state}&code=code_123`,
    );
    expect(callback_response.status).toBe(200);

    const stored_connection = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, created.connection.connection_id),
    });
    expect(stored_connection?.connection_status).not.toBe('pending_setup');
    expect(JSON.stringify(stored_connection?.setup_state)).toContain('Authorization code expired');
  });

  it('runs generic OAuth setup through callback and stores encrypted credentials', async () => {
    process.env.TEST_OAUTH_CLIENT_SECRET = 'client_secret_test';
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'test-credential-key';
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_oauth_test_app(db);
    const app = create_app(db);
    const fetch_mock = vi.fn(async () =>
      Response.json({
        access_token: 'xoxb-oauth-access',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        scope: 'channels:read chat:write',
        expires_in: 3600,
        team: { id: 'T123', name: 'Acme' },
      }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'native' }),
    });
    const created = (await create_response.json()).data;
    const authorization_url = await read_authorization_url(app, created.start_url);
    const state = authorization_url.searchParams.get('state');
    const callback_response = await app.request(
      `/v1/connections/oauth/callback?state=${state}&code=code_123`,
    );
    const callback_body = (await callback_response.json()).data.connection;
    const stored_connection = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, created.connection.connection_id),
    });

    expect(create_response.status).toBe(201);
    expect(created.setup).toMatchObject({ type: 'oauth2_authorization_code' });
    expect(created.start_url).toContain('/connect/start');
    expect(JSON.stringify(created.setup)).not.toContain('oauth_code_verifier');
    expect(authorization_url.searchParams.get('client_id')).toBe('client_123');
    expect(authorization_url.searchParams.get('scope')).toBe('channels:read chat:write');
    expect(authorization_url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(fetch_mock).toHaveBeenCalledWith(
      'https://provider.example/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(callback_body).toMatchObject({
      connection_status: 'active',
      external_account_id: 'T123',
      external_account_name: 'Acme',
      authorized_scopes: ['channels:read', 'chat:write'],
    });
    expect(callback_body).not.toHaveProperty('credentials');
    expect(JSON.stringify(stored_connection?.credentials)).not.toContain('xoxb-oauth-access');
    expect(JSON.stringify(stored_connection?.credentials)).not.toContain('refresh-token');
    expect(stored_connection?.credentials).toMatchObject({
      credential_source: 'oauth2',
      encrypted_values: {
        access_token: expect.objectContaining({ encryption: 'aes-256-gcm' }),
        refresh_token: expect.objectContaining({ encryption: 'aes-256-gcm' }),
      },
    });
  });

  it('connects a native connector app through first-party OAuth and leaves a usable token', async () => {
    process.env.CONNECTOR_NOTION_CLIENT_ID = 'notion-client-id';
    process.env.CONNECTOR_NOTION_CLIENT_SECRET = 'notion-client-secret';
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'connector-oauth-test-key';
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    await seed_connector_catalog(db);
    const notion_app = await db.query.apps.findFirst({
      where: (table, { eq }) => eq(table.app_name, 'notion'),
    });
    if (!notion_app) throw new Error('Notion connector app was not seeded');
    const app = create_app(db);
    const fetch_mock = vi.fn(async () =>
      Response.json({
        access_token: 'secret_notion_access',
        token_type: 'bearer',
        workspace_name: 'Acme',
      }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: notion_app.app_id }),
    });
    const created = (await create_response.json()).data;
    const authorization_url = await read_authorization_url(app, created.start_url);
    const state = authorization_url.searchParams.get('state');
    const callback_response = await app.request(
      `/v1/connections/oauth/callback?state=${state}&code=notion_code_123`,
    );
    const stored_connection = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, created.connection.connection_id),
    });

    expect(create_response.status).toBe(201);
    expect(authorization_url.origin + authorization_url.pathname).toBe(
      'https://api.notion.com/v1/oauth/authorize',
    );
    expect(authorization_url.searchParams.get('client_id')).toBe('notion-client-id');
    expect(authorization_url.searchParams.get('owner')).toBe('user');
    expect(authorization_url.searchParams.get('redirect_uri')).toContain(
      '/v1/connections/oauth/callback',
    );
    const [token_url, token_request] = fetch_mock.mock.calls[0] as unknown as [string, RequestInit];
    const token_headers = token_request.headers as Record<string, string>;
    expect(token_url).toBe('https://api.notion.com/v1/oauth/token');
    expect(token_headers['Content-Type']).toBe('application/json');
    expect(token_headers.Authorization).toBe(
      `Basic ${Buffer.from('notion-client-id:notion-client-secret').toString('base64')}`,
    );
    expect(JSON.parse(token_request.body as string)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'notion_code_123',
      client_id: 'notion-client-id',
    });

    expect(callback_response.status).toBe(200);
    expect(stored_connection?.connection_status).toBe('active');
    expect(stored_connection?.provider_key).toBe('native');
    expect(stored_connection?.provider_config_key).toBe('native:notion');
    expect(JSON.stringify(stored_connection?.credentials)).not.toContain('secret_notion_access');
    if (!stored_connection) throw new Error('The Notion connection was not stored');
    expect(build_connector_connection(stored_connection)?.access_token).toBe(
      'secret_notion_access',
    );
  });

  it('uses the API OAuth callback and returns the browser to the app callback', async () => {
    process.env.TEST_OAUTH_CLIENT_SECRET = 'client_secret_test';
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'oauth-return-test-key';
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_oauth_test_app(db);
    const app = create_app(db);
    const fetch_mock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        access_token: 'xoxb-oauth-access',
        token_type: 'Bearer',
        scope: 'channels:read',
        team: { id: 'T123', name: 'Acme' },
      }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: app_row.app_id,
        provider_key: 'native',
        redirect_uri: 'http://localhost:3000/connect/callback',
      }),
    });
    const created = (await create_response.json()).data;
    const authorization_url = await read_authorization_url(app, created.start_url);
    const provider_redirect_uri = authorization_url.searchParams.get('redirect_uri');
    const state = authorization_url.searchParams.get('state');
    const callback_response = await app.request(
      `/v1/connections/oauth/callback?state=${state}&code=code_123`,
    );
    const return_url = new URL(callback_response.headers.get('location') ?? '');
    const token_body = fetch_mock.mock.calls[0]?.[1]?.body as URLSearchParams;

    expect(provider_redirect_uri).toContain('/v1/connections/oauth/callback');
    expect(provider_redirect_uri).not.toContain('/connect/callback');
    expect(token_body.get('redirect_uri')).toBe(provider_redirect_uri);
    expect(callback_response.status).toBe(302);
    expect(return_url.origin).toBe('http://localhost:3000');
    expect(return_url.pathname).toBe('/connect/callback');
    expect(return_url.searchParams.get('connection_id')).toBe(created.connection.connection_id);
  });

  it('runs native Slack OAuth callback publicly and creates the default Slack channel route', async () => {
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_test';
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'slack-route-test-key';
    runtime_platform.find_primary_member_channel.mockResolvedValueOnce({
      id: 'C_MAIN',
      name: 'general',
      is_private: false,
      is_member: true,
      num_members: 12,
    });
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const app = create_app(db);
    const slack_app = await db.query.apps.findFirst({
      where: (table, { eq }) => eq(table.app_name, 'slack'),
    });
    if (!slack_app) throw new Error('Slack app seed missing');
    const fetch_mock = vi.fn(async () =>
      Response.json({
        ok: true,
        access_token: 'xoxb-slack-oauth',
        token_type: 'bot',
        scope: 'app_mentions:read,channels:read,channels:join,chat:write,users:read.email',
        team: { id: 'T999', name: 'Acme Slack' },
        bot_user_id: 'B999',
        app_id: 'A999',
      }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: slack_app.app_id, provider_key: 'native' }),
    });
    const created = (await create_response.json()).data;
    const authorization_url = await read_authorization_url(app, created.start_url);
    const state = authorization_url.searchParams.get('state');
    const callback_response = await app.request(
      `/v1/connections/oauth/callback?state=${state}&code=slack_code_123`,
    );
    const callback_body = (await callback_response.json()).data;
    const complete_response = await app.request(
      `/v1/connections/${created.connection.connection_id}/complete`,
      {
        method: 'POST',
      },
    );
    const stored_connection = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, created.connection.connection_id),
    });
    expect(create_response.status).toBe(201);
    expect(authorization_url.searchParams.get('scope')).toContain('app_mentions:read,');
    expect(authorization_url.searchParams.has('code_challenge')).toBe(false);
    expect(fetch_mock).toHaveBeenCalledWith(
      'https://slack.com/api/oauth.v2.access',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(callback_response.status).toBe(200);
    expect(callback_body.connection).toMatchObject({
      connection_status: 'active',
      external_account_id: 'T999',
      external_account_name: 'Acme Slack',
      authorized_scopes: [
        'app_mentions:read',
        'channels:read',
        'channels:join',
        'chat:write',
        'users:read.email',
      ],
    });
    expect(callback_body.default_channel).toMatchObject({
      channel_provider_key: 'slack',
      connection_id: created.connection.connection_id,
      external_account_id: 'T999',
      conversation_scope: 'any',
      target_kind: 'agent',
      target_id: bootstrap.agent_id,
      channel_config: {
        channel_policy: {
          require_bot_mention_in_channels: true,
        },
      },
    });
    expect(complete_response.status).toBe(200);
    expect((await complete_response.json()).data).toMatchObject({
      connection_id: created.connection.connection_id,
      connection_status: 'active',
      provider_key: 'native',
    });
    expect(JSON.stringify(stored_connection?.credentials)).not.toContain('xoxb-slack-oauth');
  });

  it('reports a Slack workspace another Alfera workspace claims mid-connect as claimed elsewhere', async () => {
    const { app, db, state } = await start_native_slack_oauth();
    const rival_connection = (connection_id: string, connection_status: string) => ({
      connection_id,
      connection_key: connection_id,
      connection_status,
      workspace_id: 'ws_rival',
      app_id: 'app_rival',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      external_account_id: 'T999',
      created_by: 'user_rival',
      last_updated_by: 'user_rival',
    });
    await db
      .insert(connections)
      .values([
        rival_connection('conn_rival_dead', 'active'),
        rival_connection('conn_rival_late', 'pending_setup'),
      ]);
    runtime_platform.probe_slack_connection_liveness.mockImplementationOnce(async () => {
      await db
        .update(connections)
        .set({ connection_status: 'revoked' })
        .where(eq(connections.connection_id, 'conn_rival_dead'));
      await db
        .update(connections)
        .set({ connection_status: 'active' })
        .where(eq(connections.connection_id, 'conn_rival_late'));
      return 'dead';
    });

    const callback_response = await app.request(
      `/v1/connections/oauth/callback?state=${state}&code=slack_code_123`,
    );

    expect(callback_response.status).toBe(200);
    expect(JSON.stringify(await callback_response.json())).toContain(
      'already connected to another Alfera workspace',
    );
  });

  it('does not report an unrelated unique violation as a Slack workspace claimed elsewhere', async () => {
    const { app, db, create_connection, state } = await start_native_slack_oauth();
    const other = await create_connection();
    await db
      .update(connections)
      .set({ external_account_name: 'Acme Slack' })
      .where(eq(connections.connection_id, other.connection.connection_id));
    await db.execute(
      sql`create unique index idx_test_connections_account_name on connections (external_account_name)`,
    );

    const callback_response = await app.request(
      `/v1/connections/oauth/callback?state=${state}&code=slack_code_123`,
    );

    expect(JSON.stringify(await callback_response.json())).not.toContain(
      'already connected to another Alfera workspace',
    );
    expect(callback_response.status).toBe(500);
  });

  it('returns the browser to onboarding after native Slack OAuth completes', async () => {
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_test';
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'slack-onboarding-return-test-key';
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const app = create_app(db);
    const fetch_mock = vi.fn(async () =>
      Response.json({
        ok: true,
        access_token: 'xoxb-slack-oauth',
        token_type: 'bot',
        scope: 'app_mentions:read,channels:read,channels:join,chat:write,users:read.email',
        team: { id: 'T999', name: 'Acme Slack' },
        bot_user_id: 'B999',
        app_id: 'A999',
      }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    const start_response = await app.request('/v1/slack/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uri: 'http://localhost:3000/onboarding' }),
    });
    const started = (await start_response.json()).data;
    const authorization_url = await read_authorization_url(app, started.start_url);
    const state = authorization_url.searchParams.get('state');
    const callback_response = await app.request(
      `/v1/connections/oauth/callback?state=${state}&code=slack_code_123`,
    );
    const return_url = new URL(callback_response.headers.get('location') ?? '');

    expect(start_response.status).toBe(201);
    expect(callback_response.status).toBe(302);
    expect(return_url.origin).toBe('http://localhost:3000');
    expect(return_url.pathname).toBe('/onboarding');
    expect(return_url.searchParams.get('connection_id')).toBe(started.connection.connection_id);
  });
});

async function create_private_connection_test_context() {
  const db = await create_test_database();
  const organization_id = 'org_connection_access';
  const owner_identity = {
    provider_key: 'workos',
    provider_user_id: 'workos_owner',
    email: 'owner@example.com',
    organization_id,
  } as const;
  const teammate_identity = {
    provider_key: 'workos',
    provider_user_id: 'workos_teammate',
    email: 'teammate@example.com',
    organization_id,
  } as const;
  const owner = await provision_workspace_for_identity(db, owner_identity);
  const teammate = await provision_workspace_for_identity(db, teammate_identity);
  const app_row = await insert_api_test_app(db);
  const app = create_app(db);
  const owner_headers = identity_headers(owner_identity);
  const teammate_headers = identity_headers(teammate_identity);
  const create_response = await app.request('/v1/connections', {
    method: 'POST',
    headers: owner_headers,
    body: JSON.stringify({
      app_id: app_row.app_id,
      provider_key: 'composio',
      access_type: 'restricted',
    }),
  });
  if (!create_response.ok) throw new Error('Private connection setup failed');
  const connection_id = (await create_response.json()).data.connection.connection_id as string;

  return { app, db, connection_id, owner, owner_headers, teammate, teammate_headers };
}

async function insert_api_test_app(db: Awaited<ReturnType<typeof create_test_database>>) {
  const [app] = await db
    .insert(apps)
    .values({
      app_id: create_id(id_prefixes.app),
      app_name: 'gmail_api',
      app_key: 'gmail_api',
      catalog_scope: 'global',
      app_display_name: 'Gmail API',
      auth_type: 'oauth2',
      app_status: 'active',
      display_config: {},
      metadata: {
        provider_configs: [
          {
            provider_key: 'composio',
            provider_config_key: 'composio:gmail_api',
            version: 1,
            status: 'active',
            provider_app_key: 'gmail',
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: 'composio:gmail_api:managed_oauth',
                version: 1,
                status: 'active',
                auth_method_key: 'composio_managed_auth',
                setup_strategy: { type: 'connect_token' },
                runtime_credential_strategy: { type: 'provider_account_reference' },
                default_scopes: [],
              },
            ],
          },
        ],
      },
      created_by: 'test',
      last_updated_by: 'test',
    })
    .returning();
  if (!app) throw new Error('app insert failed');
  return app;
}

async function insert_oauth_test_app(db: Awaited<ReturnType<typeof create_test_database>>) {
  const [app] = await db
    .insert(apps)
    .values({
      app_id: create_id(id_prefixes.app),
      app_name: 'oauth_api',
      app_key: 'oauth_api',
      catalog_scope: 'global',
      app_display_name: 'OAuth API',
      auth_type: 'oauth2',
      app_status: 'active',
      display_config: {},
      metadata: {
        provider_configs: [
          {
            provider_key: 'native',
            provider_config_key: 'native:oauth_api',
            version: 1,
            status: 'active',
            provider_app_key: 'oauth_api',
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: 'native:oauth_api:oauth2',
                version: 1,
                status: 'active',
                auth_method_key: 'oauth2_authorization_code',
                setup_strategy: {
                  type: 'oauth2_authorization_code',
                  authorization_url: 'https://provider.example/authorize',
                  token_url: 'https://provider.example/token',
                  client_id: 'client_123',
                  client_secret_env: 'TEST_OAUTH_CLIENT_SECRET',
                  use_pkce: true,
                },
                runtime_credential_strategy: {
                  type: 'encrypted_connection_credentials',
                  token_field: 'access_token',
                },
                default_scopes: ['channels:read', 'chat:write'],
              },
            ],
          },
        ],
      },
      created_by: 'test',
      last_updated_by: 'test',
    })
    .returning();
  if (!app) throw new Error('app insert failed');
  return app;
}

async function start_native_slack_oauth() {
  process.env.SLACK_CLIENT_ID = 'slack_client_123';
  process.env.SLACK_CLIENT_SECRET = 'slack_secret_test';
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'slack-claim-test-key';
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const app = create_app(db);
  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app seed missing');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ok: true,
        access_token: 'xoxb-slack-oauth',
        token_type: 'bot',
        scope: 'app_mentions:read,chat:write',
        team: { id: 'T999', name: 'Acme Slack' },
        bot_user_id: 'B999',
        app_id: 'A999',
      }),
    ),
  );
  const create_connection = async () => {
    const response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: slack_app.app_id, provider_key: 'native' }),
    });
    return (await response.json()).data;
  };
  const created = await create_connection();
  const authorization_url = await read_authorization_url(app, created.start_url);
  return { app, db, create_connection, state: authorization_url.searchParams.get('state') };
}
