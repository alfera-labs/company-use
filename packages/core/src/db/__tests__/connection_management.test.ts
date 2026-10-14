import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_apps, list_nodes } from '@coworker/core/db/queries/catalog';
import {
  create_pending_connection_setup,
  expire_stale_pending_connection_setups,
  finalize_provider_connection,
  get_pending_connection_setup_by_setup_token,
  get_pending_provider_connection_setup,
  list_agent_enabled_nodes,
  list_redacted_connections,
  pending_connection_setup_expiry_ms,
  reconnect_connection,
  update_agent_enabled_nodes,
} from '@coworker/core/db/queries/connection_management';
import { create_workspace_mcp_catalog } from '@coworker/core/db/queries/mcp_catalog';
import { apps, connections, nodes, workspaces } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('connection management database behavior', () => {
  it('redacts credentials from connection DTOs', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });

    await finalize_provider_connection(db, {
      workspace_id: bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: setup.connection.connection_id,
      status: 'success',
      external_account_id: 'apn_gmail_123',
      external_account_name: 'otto@example.com',
      provider_account: { authProvisionId: 'apn_gmail_123', access_token: 'secret' },
      actor_id: bootstrap.user_id,
    });

    const [connection] = await list_redacted_connections(db, bootstrap.workspace_id);
    expect(connection).not.toHaveProperty('credentials');
    expect(connection?.app).toMatchObject({
      app_name: 'gmail',
      app_display_name: 'Gmail',
      display_config: { icon_url: 'https://example.com/gmail.png' },
    });
    expect(connection?.provider_account).toMatchObject({
      authProvisionId: 'apn_gmail_123',
      access_token: '[redacted]',
    });
  });

  it('promotes pending setup to active and keeps failed setup queryable', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const active_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });
    const failed_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });

    await finalize_provider_connection(db, {
      workspace_id: bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: active_setup.connection.connection_id,
      status: 'success',
      external_account_id: 'apn_active',
      actor_id: bootstrap.user_id,
    });
    await finalize_provider_connection(db, {
      workspace_id: bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: failed_setup.connection.connection_id,
      status: 'error',
      error_message: 'denied',
      actor_id: bootstrap.user_id,
    });

    const connections = await list_redacted_connections(db, bootstrap.workspace_id);
    expect(connections.map((connection) => connection.connection_status).sort()).toEqual([
      'active',
      'failed',
    ]);
  });

  it('stores an optional resume intent inside pending setup state', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);

    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_resume',
        instruction: 'Pull the latest five emails.',
        created_at: '2026-07-07T10:00:00.000Z',
      },
    });

    expect(setup.setup).toMatchObject({
      connection_id: setup.connection.connection_id,
      setup_token: expect.any(String),
      resume: {
        session_id: 'ses_resume',
        instruction: 'Pull the latest five emails.',
        created_at: '2026-07-07T10:00:00.000Z',
      },
    });
  });

  it('validates pending setup links with the setup token', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });
    const setup_state = setup.setup as Record<string, unknown>;

    await expect(
      get_pending_connection_setup_by_setup_token(db, {
        connection_id: setup.connection.connection_id,
        setup_token: String(setup_state.setup_token),
      }),
    ).resolves.toMatchObject({
      connection_id: setup.connection.connection_id,
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
    });
    await expect(
      get_pending_connection_setup_by_setup_token(db, {
        connection_id: setup.connection.connection_id,
        setup_token: 'wrong-token',
      }),
    ).rejects.toThrow('Invalid connection setup token');
  });

  it('reuses a pending setup for repeated resume requests in the same session', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const first_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_same_thread',
        instruction: 'First instruction.',
        created_at: '2026-07-07T11:00:00.000Z',
      },
    });
    const second_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_same_thread',
        instruction: 'Second instruction.',
        created_at: '2026-07-07T11:01:00.000Z',
      },
    });
    const first_state = first_setup.setup as Record<string, unknown>;
    const second_state = second_setup.setup as Record<string, unknown>;
    const rows = await db.select().from(connections).where(eq(connections.app_id, app.app_id));

    expect(second_setup.connection.connection_id).toBe(first_setup.connection.connection_id);
    expect(rows).toHaveLength(1);
    expect(second_state.setup_token).toBe(first_state.setup_token);
    expect(second_state.resume).toMatchObject({
      session_id: 'ses_same_thread',
      instruction: 'Second instruction.',
      created_at: '2026-07-07T11:01:00.000Z',
    });
  });

  it('reuses one pending authorization when the same actor asks from another session', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const first_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_first_thread',
        actor_id: 'slack:T1:U1',
        instruction: 'Connect GitHub.',
        created_at: '2026-07-07T11:00:00.000Z',
      },
    });
    const second_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_second_thread',
        actor_id: 'slack:T1:U1',
        instruction: 'Connect GitHub for this task.',
        created_at: '2026-07-07T11:01:00.000Z',
      },
    });

    const rows = await db.select().from(connections).where(eq(connections.app_id, app.app_id));
    expect(second_setup.connection.connection_id).toBe(first_setup.connection.connection_id);
    expect(rows).toHaveLength(1);
    expect(second_setup.setup).toMatchObject({
      resume: { session_id: 'ses_second_thread' },
    });
  });

  it('does not reuse a pending authorization across different Slack speakers', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const first_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_first_thread',
        actor_id: 'slack:T1:U1',
        instruction: 'Connect GitHub.',
        created_at: '2026-07-07T11:00:00.000Z',
      },
    });
    const second_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_second_thread',
        actor_id: 'slack:T1:U2',
        instruction: 'Connect GitHub.',
        created_at: '2026-07-07T11:01:00.000Z',
      },
    });

    expect(second_setup.connection.connection_id).not.toBe(first_setup.connection.connection_id);
    expect(
      await db.select().from(connections).where(eq(connections.app_id, app.app_id)),
    ).toHaveLength(2);
  });

  it('reuses a pending setup for repeated connection-only requests by the same actor', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);

    const first_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      setup_session_id: 'ses_connect_only',
    });
    const second_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      setup_session_id: 'ses_connect_only',
    });
    const first_state = first_setup.setup as Record<string, unknown>;
    const second_state = second_setup.setup as Record<string, unknown>;
    const rows = await db.select().from(connections).where(eq(connections.app_id, app.app_id));

    expect(second_setup.connection.connection_id).toBe(first_setup.connection.connection_id);
    expect(rows).toHaveLength(1);
    expect(second_state.setup_token).toBe(first_state.setup_token);
    expect(second_state.setup_session_id).toBe('ses_connect_only');
    expect(second_state).not.toHaveProperty('resume');
  });

  it('expires setup rows at fifteen minutes and clears resume state', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const now = new Date('2026-07-07T12:00:00.000Z');

    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_resume',
        instruction: 'Pull the latest five emails.',
        created_at: '2026-07-07T11:40:00.000Z',
      },
    });
    await db
      .update(connections)
      .set({
        created_time: new Date(now.getTime() - pending_connection_setup_expiry_ms),
        setup_state: {
          ...(setup.setup as Record<string, unknown>),
          setup_started_time: new Date(
            now.getTime() - pending_connection_setup_expiry_ms,
          ).toISOString(),
        },
      })
      .where(eq(connections.connection_id, setup.connection.connection_id));

    const expired = await expire_stale_pending_connection_setups(db, {
      workspace_id: bootstrap.workspace_id,
      now,
      actor_id: 'test:expiry',
    });

    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      connection_id: setup.connection.connection_id,
      connection_status: 'expired',
      health_status: 'unhealthy',
      setup_state: {
        expired_reason: 'setup_timed_out',
        expired_time: '2026-07-07T12:00:00.000Z',
      },
      last_updated_by: 'test:expiry',
    });
    expect(expired[0]?.setup_state).not.toHaveProperty('resume');
    expect(expired[0]?.setup_state).not.toHaveProperty('provider_webhook_token');
    await expect(
      get_pending_provider_connection_setup(db, {
        workspace_id: bootstrap.workspace_id,
        connection_id: setup.connection.connection_id,
        provider_key: 'composio',
      }),
    ).rejects.toThrow('Connection is not pending setup');
    await expect(list_redacted_connections(db, bootstrap.workspace_id)).resolves.toEqual([]);
  });

  it('expires setup token links with the same fifteen minute window', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });
    const setup_state = setup.setup as Record<string, unknown>;

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
      .where(eq(connections.connection_id, setup.connection.connection_id));

    await expect(
      get_pending_connection_setup_by_setup_token(db, {
        connection_id: setup.connection.connection_id,
        setup_token: String(setup_state.setup_token),
      }),
    ).rejects.toThrow('Connection setup expired');

    const stored_connection = await db.query.connections.findFirst({
      where: (table) => eq(table.connection_id, setup.connection.connection_id),
    });
    expect(stored_connection?.connection_status).toBe('expired');
    expect(stored_connection?.setup_state).toMatchObject({
      expired_reason: 'setup_timed_out',
    });
  });

  it('keeps setup rows younger than fifteen minutes pending', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const now = new Date('2026-07-07T12:00:00.000Z');

    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
      resume: {
        session_id: 'ses_resume',
        instruction: 'Pull the latest five emails.',
        created_at: '2026-07-07T11:45:00.001Z',
      },
    });
    await db
      .update(connections)
      .set({
        created_time: new Date(now.getTime() - pending_connection_setup_expiry_ms + 1),
        setup_state: {
          ...(setup.setup as Record<string, unknown>),
          setup_started_time: new Date(
            now.getTime() - pending_connection_setup_expiry_ms + 1,
          ).toISOString(),
        },
      })
      .where(eq(connections.connection_id, setup.connection.connection_id));

    const expired = await expire_stale_pending_connection_setups(db, {
      workspace_id: bootstrap.workspace_id,
      now,
      actor_id: 'test:expiry',
    });

    expect(expired).toEqual([]);
    const pending = await db.query.connections.findFirst({
      where: (table) => eq(table.connection_id, setup.connection.connection_id),
    });
    expect(pending?.connection_status).toBe('pending_setup');
    expect(pending?.setup_state).toMatchObject({
      resume: {
        session_id: 'ses_resume',
        instruction: 'Pull the latest five emails.',
        created_at: '2026-07-07T11:45:00.001Z',
      },
    });
  });

  it('expires a stale setup row even when the batch cleanup cap misses it', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const now = new Date();
    const target_setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });
    const stale_time = new Date(now.getTime() - pending_connection_setup_expiry_ms - 1_000);
    const older_stale_time = new Date(stale_time.getTime() - 1_000);

    await db.insert(connections).values(
      Array.from({ length: 100 }, (_, index) => ({
        connection_id: create_id(id_prefixes.connection),
        workspace_id: bootstrap.workspace_id,
        app_id: app.app_id,
        connection_key: `composio:gmail:older-stale-${index}`,
        connection_name: `Older stale ${index}`,
        connection_status: 'pending_setup',
        provider_key: 'composio',
        provider_config_key: 'composio:gmail',
        provider_config_version: 1,
        connection_profile_key: 'composio:gmail:default',
        connection_profile_version: 1,
        auth_method_key: 'composio_managed_auth',
        external_user_key: `ws_${bootstrap.workspace_id}`,
        authorized_scopes: [],
        health_status: 'unknown',
        connection_config: {},
        setup_state: { connection_id: `older-stale-${index}` },
        provider_account: {},
        metadata: {},
        created_time: older_stale_time,
        created_by: bootstrap.user_id,
        last_updated_by: bootstrap.user_id,
      })),
    );
    await db
      .update(connections)
      .set({
        created_time: stale_time,
        setup_state: {
          ...(target_setup.setup as Record<string, unknown>),
          setup_started_time: stale_time.toISOString(),
        },
      })
      .where(eq(connections.connection_id, target_setup.connection.connection_id));

    await expect(
      get_pending_provider_connection_setup(db, {
        workspace_id: bootstrap.workspace_id,
        connection_id: target_setup.connection.connection_id,
        provider_key: 'composio',
      }),
    ).rejects.toThrow('Connection setup expired');

    const target = await db.query.connections.findFirst({
      where: (table) => eq(table.connection_id, target_setup.connection.connection_id),
    });
    expect(target?.connection_status).toBe('expired');
    expect(target?.setup_state).toMatchObject({ expired_reason: 'setup_timed_out' });
  });

  it('measures reconnect expiry from setup_started_time', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const now = new Date('2026-07-07T12:00:00.000Z');
    const old_created_time = new Date(now.getTime() - pending_connection_setup_expiry_ms * 4);
    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });
    await finalize_provider_connection(db, {
      workspace_id: bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: setup.connection.connection_id,
      status: 'success',
      external_account_id: 'apn_reconnect',
      actor_id: bootstrap.user_id,
    });
    await db
      .update(connections)
      .set({ created_time: old_created_time })
      .where(eq(connections.connection_id, setup.connection.connection_id));

    const reconnected = await reconnect_connection(db, {
      workspace_id: bootstrap.workspace_id,
      connection_id: setup.connection.connection_id,
      redirect_uri: 'https://app.example.test/connect/callback',
      actor_id: bootstrap.user_id,
    });
    const setup_state = reconnected.setup_state as Record<string, unknown>;
    const expired = await expire_stale_pending_connection_setups(db, {
      workspace_id: bootstrap.workspace_id,
      now,
      actor_id: 'test:expiry',
    });

    expect(expired).toEqual([]);
    expect(setup_state).toMatchObject({
      setup_started_time: expect.any(String),
      redirect_uri: 'https://app.example.test/connect/callback',
    });
    expect(setup_state).not.toHaveProperty('resume');
    expect(setup_state).toMatchObject({ setup_token: expect.any(String) });
  });

  it('falls back to created_time when old pending rows do not have setup_started_time', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const now = new Date('2026-07-07T12:00:00.000Z');
    const setup = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });
    await db
      .update(connections)
      .set({
        created_time: new Date(now.getTime() - pending_connection_setup_expiry_ms),
        setup_state: { connection_id: setup.connection.connection_id },
      })
      .where(eq(connections.connection_id, setup.connection.connection_id));

    const expired = await expire_stale_pending_connection_setups(db, {
      workspace_id: bootstrap.workspace_id,
      now,
      actor_id: 'test:expiry',
    });

    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      connection_id: setup.connection.connection_id,
      connection_status: 'expired',
    });
  });

  it('revokes older active connections for the same app and external account', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = await insert_composio_app(db);
    const first = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });
    const second = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });
    const other = await create_pending_connection_setup(db, {
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      provider_key: 'composio',
      actor_id: bootstrap.user_id,
    });

    await finalize_provider_connection(db, {
      workspace_id: bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: first.connection.connection_id,
      status: 'success',
      external_account_id: 'apn_same',
      actor_id: bootstrap.user_id,
    });
    await finalize_provider_connection(db, {
      workspace_id: bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: other.connection.connection_id,
      status: 'success',
      external_account_id: 'apn_other',
      actor_id: bootstrap.user_id,
    });
    await finalize_provider_connection(db, {
      workspace_id: bootstrap.workspace_id,
      provider_key: 'composio',
      connection_id: second.connection.connection_id,
      status: 'success',
      external_account_id: 'apn_same',
      actor_id: bootstrap.user_id,
    });

    const rows = await db.query.connections.findMany({
      where: eq(connections.app_id, app.app_id),
    });
    const by_id = new Map(rows.map((connection) => [connection.connection_id, connection]));

    expect(by_id.get(first.connection.connection_id)).toMatchObject({
      connection_status: 'revoked',
      health_status: 'unhealthy',
      connection_config: {
        superseded_by_connection_id: second.connection.connection_id,
      },
    });
    expect(by_id.get(second.connection.connection_id)?.connection_status).toBe('active');
    expect(by_id.get(other.connection.connection_id)?.connection_status).toBe('active');
  });

  it('scopes workspace apps and nodes while keeping global catalog visible', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const [other_workspace] = await db
      .insert(workspaces)
      .values({
        workspace_name: 'Other',
        workspace_slug: 'other',
        workspace_status: 'active',
        created_by: 'test',
        last_updated_by: 'test',
      })
      .returning();
    if (!other_workspace) throw new Error('other workspace insert failed');
    await insert_native_app(db);
    const private_catalog = await create_workspace_mcp_catalog(db, {
      workspace_id: bootstrap.workspace_id,
      server_key: 'linear_private',
      server_name: 'Private Linear',
      transport_config: { type: 'http', url: 'https://linear.example/mcp' },
      tools: [{ tool_name: 'list_issues', display_name: 'List issues' }],
      actor_id: bootstrap.user_id,
    });

    const visible_to_owner = await list_apps(db, bootstrap.workspace_id);
    const visible_to_other = await list_apps(db, other_workspace.workspace_id);
    const owner_nodes = await list_nodes(db, { workspace_id: bootstrap.workspace_id });
    const other_nodes = await list_nodes(db, { workspace_id: other_workspace.workspace_id });

    expect(visible_to_owner.map((app) => app.app_name)).toEqual(
      expect.arrayContaining(['native_app', 'mcp_linear_private']),
    );
    expect(visible_to_other.map((app) => app.app_name)).toContain('native_app');
    expect(visible_to_other.map((app) => app.app_name)).not.toContain('mcp_linear_private');
    expect(owner_nodes.map((node) => node.node_key)).toContain('mcp_linear_private-list_issues-1');
    expect(other_nodes.map((node) => node.node_key)).not.toContain(
      'mcp_linear_private-list_issues-1',
    );
    await expect(
      create_pending_connection_setup(db, {
        workspace_id: other_workspace.workspace_id,
        app_id: private_catalog.app_id,
        actor_id: bootstrap.user_id,
      }),
    ).rejects.toThrow(/App/u);

    const other_private_catalog = await create_workspace_mcp_catalog(db, {
      workspace_id: other_workspace.workspace_id,
      server_key: 'linear_private',
      server_name: 'Private Linear',
      transport_config: { type: 'http', url: 'https://linear-other.example/mcp' },
      auth_config: { type: 'api_key' },
      tools: [{ tool_name: 'list_issues', display_name: 'List issues' }],
      actor_id: bootstrap.user_id,
    });
    await expect(
      create_pending_connection_setup(db, {
        workspace_id: other_workspace.workspace_id,
        app_id: other_private_catalog.app_id,
        actor_id: bootstrap.user_id,
      }),
    ).resolves.toMatchObject({
      connection: {
        app_id: other_private_catalog.app_id,
        workspace_id: other_workspace.workspace_id,
      },
    });
  });

  it('reads and updates enabled nodes from agent_config without agent_nodes', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await update_agent_enabled_nodes(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
      enabled_nodes: [
        {
          node_key: 'runtime-search_context-1',
          provider_key: 'native',
          status: 'enabled',
          connection_selector: { strategy: 'no_connection_required' },
          input_defaults: {},
          approval_policy_override: null,
        },
      ],
    });

    await expect(list_agent_enabled_nodes(db, bootstrap)).resolves.toMatchObject([
      {
        node_key: 'runtime-search_context-1',
        provider_key: 'native',
      },
    ]);
  });

  it('gives lossy colliding MCP identifiers distinct stable model-facing names', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const catalog = await create_workspace_mcp_catalog(db, {
      workspace_id: bootstrap.workspace_id,
      server_key: 'My.Server',
      server_name: 'Unsafe identifiers',
      transport_config: { type: 'http', url: 'https://example.com/mcp' },
      tools: [
        { tool_name: 'foo-bar', display_name: 'Foo hyphen' },
        { tool_name: 'foo_bar', display_name: 'Foo underscore' },
      ],
      actor_id: bootstrap.user_id,
    });

    const app = await db.query.apps.findFirst({ where: eq(apps.app_id, catalog.app_id) });
    expect(app?.app_name).toMatch(/^mcp_my_server_[a-f0-9]{8}$/u);
    expect(catalog.nodes.map((node) => node.node_name)).toEqual([
      expect.stringMatching(/^foo_bar_[a-f0-9]{8}$/u),
      expect.stringMatching(/^foo_bar_[a-f0-9]{8}$/u),
    ]);
    expect(new Set(catalog.nodes.map((node) => node.node_name)).size).toBe(2);
    expect(catalog.nodes.every((node) => node.node_key.length <= 64)).toBe(true);
  });
});

async function insert_composio_app(db: Awaited<ReturnType<typeof create_test_database>>) {
  const app_id = create_id(id_prefixes.app);
  const [app] = await db
    .insert(apps)
    .values({
      app_id,
      app_name: 'gmail',
      app_key: 'gmail',
      catalog_scope: 'global',
      app_display_name: 'Gmail',
      app_category: 'email',
      auth_type: 'oauth2',
      app_status: 'active',
      display_config: { icon_url: 'https://example.com/gmail.png' },
      metadata: {
        provider_configs: [
          {
            provider_key: 'composio',
            provider_config_key: 'composio:gmail',
            version: 1,
            status: 'active',
            provider_app_key: 'gmail',
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: 'composio:gmail:managed_oauth',
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

async function insert_native_app(db: Awaited<ReturnType<typeof create_test_database>>) {
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: 'native_app',
    app_key: 'native_app',
    catalog_scope: 'global',
    app_display_name: 'Native app',
    auth_type: 'none',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  });
  await db.insert(nodes).values({
    node_id: create_id(id_prefixes.node),
    app_id,
    app_key: 'native_app',
    node_name: 'ping',
    catalog_scope: 'global',
    node_key: 'native_app-ping-1',
    node_version: 1,
    node_display_name: 'Ping',
    node_kind: 'tool',
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object', properties: {} },
    approval_policy: { mode: 'none' },
    runtime_handler: 'native.ping',
    node_runtime: 'native_tool',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'native',
    provider_config_key: 'native:native_app',
    provider_config_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: {},
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  });

  return db.query.apps.findFirst({ where: eq(apps.app_id, app_id) });
}
