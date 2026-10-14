import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_project } from '@coworker/core/db/queries/projects';
import { connections } from '@coworker/core/db/schema';
import {
  find_slack_channel_agent_for_event,
  upsert_default_slack_channel_for_connection,
} from '@runtime-platform/channels/slack/channel_setup';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack_api = vi.hoisted(() => ({
  fetch_settings: vi.fn(),
  fetch_is_private: vi.fn(),
  join_channel: vi.fn(),
}));

vi.mock('@runtime-platform/tools/slack/channels_api', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/tools/slack/channels_api')>();
  return {
    ...actual,
    fetch_slack_channels: slack_api.fetch_settings,
    fetch_slack_channel_is_private: slack_api.fetch_is_private,
    join_slack_channel: slack_api.join_channel,
  };
});

describe('Slack channel settings routes', () => {
  afterEach(() => {
    slack_api.fetch_settings.mockReset();
    slack_api.fetch_is_private.mockReset();
    slack_api.join_channel.mockReset();
  });

  it('lists public channel membership for the active Slack connection', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap);
    const app = await create_test_app(db);
    slack_api.fetch_settings.mockResolvedValue({
      channels: [
        { id: 'C_GENERAL', name: 'general', is_private: false, is_member: true, num_members: 12 },
        { id: 'C_SALES', name: 'sales', is_private: false, is_member: false, num_members: 4 },
      ],
      next_cursor: 'cursor_next',
    });

    const response = await app.request('/v1/slack/channel-settings?visibility=public&cursor=abc');
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toEqual({
      channels: [
        {
          id: 'C_GENERAL',
          name: 'general',
          is_private: false,
          is_member: true,
          is_enabled: true,
          num_members: 12,
          project_id: null,
          channel_route_id: null,
        },
        {
          id: 'C_SALES',
          name: 'sales',
          is_private: false,
          is_member: false,
          is_enabled: false,
          num_members: 4,
          project_id: null,
          channel_route_id: null,
        },
      ],
      next_cursor: 'cursor_next',
    });
    expect(slack_api.fetch_settings).toHaveBeenCalledWith('xoxb-settings', {
      visibility: 'public',
      cursor: 'abc',
    });
  });

  it('lists private channels visible to the bot token', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap);
    const app = await create_test_app(db);
    slack_api.fetch_settings.mockResolvedValue({
      channels: [
        {
          id: 'G_PRIVATE',
          name: 'leadership',
          is_private: true,
          is_member: true,
          num_members: null,
        },
      ],
      next_cursor: null,
    });

    const response = await app.request('/v1/slack/channel-settings?visibility=private');
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data.channels).toEqual([
      {
        id: 'G_PRIVATE',
        name: 'leadership',
        is_private: true,
        is_member: true,
        is_enabled: true,
        num_members: null,
        project_id: null,
        channel_route_id: null,
      },
    ]);
    expect(slack_api.fetch_settings).toHaveBeenCalledWith('xoxb-settings', {
      visibility: 'private',
    });
  });

  it('joins public channels and stores channel access through the settings route', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap);
    const app = await create_test_app(db);
    slack_api.fetch_is_private.mockResolvedValue(false);
    slack_api.join_channel.mockResolvedValue({
      channel_id: 'C_SALES',
      already_in_channel: true,
    });

    const join_response = await app.request('/v1/slack/channel-settings/C_SALES', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    const enabled_channel = await find_settings_channel(db, 'C_SALES');
    const leave_response = await app.request('/v1/slack/channel-settings/C_SALES', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    const disabled_channel = await find_settings_channel(db, 'C_SALES');

    expect(join_response.status).toBe(200);
    await expect(join_response.json()).resolves.toMatchObject({
      data: { channel_id: 'C_SALES', is_enabled: true, already_in_channel: true },
    });
    expect(enabled_channel).toMatchObject({ channel_status: 'enabled' });
    expect(leave_response.status).toBe(200);
    await expect(leave_response.json()).resolves.toMatchObject({
      data: { channel_id: 'C_SALES', is_enabled: false },
    });
    expect(disabled_channel).toMatchObject({ channel_status: 'disabled' });
    expect(slack_api.join_channel).toHaveBeenCalledWith('xoxb-settings', 'C_SALES');
  });

  it('enables a private channel whose id starts with C without trying to join it', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap);
    const app = await create_test_app(db);
    slack_api.fetch_is_private.mockResolvedValue(true);

    const response = await app.request('/v1/slack/channel-settings/C_NEW_PRIVATE', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ channel_id: 'C_NEW_PRIVATE', is_enabled: true });
    expect(slack_api.join_channel).not.toHaveBeenCalled();
    expect(slack_api.fetch_is_private).toHaveBeenCalledWith('xoxb-settings', 'C_NEW_PRIVATE');
    await expect(find_settings_channel(db, 'C_NEW_PRIVATE')).resolves.toMatchObject({
      channel_status: 'enabled',
      conversation_scope: 'group',
    });
  });

  // #sales works in Sales: new chats there start in the project, so they read its instructions and
  // use only what it was given. The project page lists the channel and can take it out again.
  it('puts a channel in a project, routes it there, and takes it out from the project page', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap);
    const app = await create_test_app(db);
    slack_api.join_channel.mockResolvedValue({ channel_id: 'C_SALES', already_in_channel: true });
    const sales = await create_project(db, {
      workspace_id: bootstrap.workspace_id,
      project_name: 'Sales',
      actor_id: bootstrap.user_id,
      owner_id: bootstrap.user_id,
    });
    const put = (body: object) =>
      app.request('/v1/slack/channel-settings/C_SALES', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const linked = await put({
      enabled: true,
      project_id: sales.project_id,
      channel_name: 'sales',
    });
    const route = await find_slack_route_for_channel(db, bootstrap, 'C_SALES');
    const listed = await app.request(`/v1/projects/${sales.project_id}/channels`);
    const toggled = await put({ enabled: true });
    const still_linked = await find_settings_channel(db, 'C_SALES');
    const removed = await app.request(
      `/v1/projects/${sales.project_id}/channels/${route?.channel.channel_id}`,
      { method: 'DELETE' },
    );
    const after_remove = await find_settings_channel(db, 'C_SALES');
    const unknown_project = await put({ enabled: true, project_id: 'prj_missing' });

    expect(linked.status).toBe(200);
    await expect(linked.json()).resolves.toMatchObject({ data: { project_id: sales.project_id } });
    expect(route?.channel.project_id).toBe(sales.project_id);
    await expect(listed.json()).resolves.toMatchObject({
      data: [{ channel_name: 'sales', external_conversation_id: 'C_SALES' }],
    });
    // Turning a channel on again without a project_id keeps the project it has.
    expect(toggled.status).toBe(200);
    expect(still_linked?.project_id).toBe(sales.project_id);
    expect(removed.status).toBe(204);
    expect(after_remove?.project_id).toBeNull();
    expect(unknown_project.status).toBe(404);
  });

  it('disables channel access without leaving Slack membership', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_connection(db, bootstrap);
    await create_default_slack_route(db, bootstrap);
    const app = await create_test_app(db);
    const response = await app.request('/v1/slack/channel-settings/C_ARCHIVE', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    const body = await response.json();
    const disabled_channel = await find_settings_channel(db, 'C_ARCHIVE');

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({
      channel_id: 'C_ARCHIVE',
      is_enabled: false,
    });
    expect(disabled_channel).toMatchObject({ channel_status: 'disabled' });
    await expect(find_slack_route_for_channel(db, bootstrap, 'C_ARCHIVE')).resolves.toBeNull();
  });

  it('returns a clear error when Slack is not connected', async () => {
    const db = await create_test_database();
    const app = await create_test_app(db);

    const response = await app.request('/v1/slack/channel-settings?visibility=public');
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'slack_not_connected',
      message: 'Connect Slack before managing channels.',
    });
    expect(slack_api.fetch_settings).not.toHaveBeenCalled();
  });
});

async function create_test_app(db: Awaited<ReturnType<typeof create_test_database>>) {
  const { create_app } = await import('@api/app');
  return create_app(db);
}

async function find_settings_channel(
  db: Awaited<ReturnType<typeof create_test_database>>,
  external_conversation_id: string,
) {
  return db.query.channels.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.channel_provider_key, 'slack'),
        eq(table.external_conversation_id, external_conversation_id),
      ),
  });
}

async function create_default_slack_route(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
) {
  return upsert_default_slack_channel_for_connection(db, {
    connection: slack_test_connection(bootstrap.workspace_id),
    actor_id: bootstrap.user_id,
  });
}

async function find_slack_route_for_channel(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  external_conversation_id: string,
) {
  return find_slack_channel_agent_for_event(db, {
    workspace_id: bootstrap.workspace_id,
    connection_id: 'conn_slack_settings',
    external_account_id: 'T_SETTINGS',
    external_conversation_id,
    conversation_scope: 'channel',
  });
}

async function insert_slack_connection(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  overrides: Partial<typeof connections.$inferInsert> = {},
) {
  await db.insert(connections).values({
    connection_id: 'conn_slack_settings',
    workspace_id: bootstrap.workspace_id,
    app_id: 'app_slack_settings',
    connection_name: 'Slack settings test',
    connection_status: 'active',
    connection_key: 'native:slack:settings-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T_SETTINGS',
    external_account_name: 'Settings workspace',
    authorized_scopes: ['channels:join', 'channels:read', 'groups:read'],
    health_status: 'healthy',
    credentials: { bot_token: 'xoxb-settings' },
    provider_account: { team_id: 'T_SETTINGS', app_id: 'A_SETTINGS', bot_user_id: 'B_SETTINGS' },
    metadata: {},
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
    ...overrides,
  });
}

function slack_test_connection(workspace_id: string) {
  return {
    connection_id: 'conn_slack_settings',
    workspace_id,
    provider_key: 'native',
    provider_config_key: 'native:slack',
    connection_profile_key: 'native:slack:oauth_bot',
    external_account_id: 'T_SETTINGS',
    external_account_name: 'Settings workspace',
  } as const;
}
