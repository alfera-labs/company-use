import { beforeEach, describe, expect, it, vi } from 'vitest';

const cron_schedule = {
  supports_run_once: true,
  set_schedule: vi.fn(async () => {}),
  pause_schedule: vi.fn(async () => {}),
  delete_schedule: vi.fn(async () => {}),
};
type PrimaryMemberChannel = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members: number | null;
} | null;

const runtime_platform = vi.hoisted(() => ({
  find_primary_member_channel: vi.fn<() => Promise<PrimaryMemberChannel>>(async () => null),
  lookup_slack_user_id_by_email: vi.fn(async () => null as string | null),
  open_slack_dm_channel: vi.fn(async () => null as string | null),
  post_slack_message: vi.fn(
    async (_token: string, _channel: string, _text: string) => '1700000000.000001' as string | null,
  ),
}));

const capture_product_event = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@api/services/product_events', () => ({ capture_product_event }));
vi.mock('@api/services/scheduling/cron_schedule', () => ({
  get_cron_schedule: async () => cron_schedule,
}));
vi.mock('@coworker/runtime-platform', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/runtime-platform')>();
  return {
    ...actual,
    find_primary_member_channel: runtime_platform.find_primary_member_channel,
    lookup_slack_user_id_by_email: runtime_platform.lookup_slack_user_id_by_email,
    open_slack_dm_channel: runtime_platform.open_slack_dm_channel,
    post_slack_message: runtime_platform.post_slack_message,
  };
});

const { create_app } = await import('@api/app');
const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
const { connections, users } = await import('@coworker/core/db/schema');
const { eq } = await import('drizzle-orm');

describe('onboarding routes', () => {
  beforeEach(() => {
    cron_schedule.set_schedule.mockClear();
    cron_schedule.pause_schedule.mockClear();
    cron_schedule.delete_schedule.mockClear();
    runtime_platform.find_primary_member_channel.mockReset();
    runtime_platform.find_primary_member_channel.mockResolvedValue(null);
    runtime_platform.lookup_slack_user_id_by_email.mockClear();
    runtime_platform.open_slack_dm_channel.mockClear();
    runtime_platform.open_slack_dm_channel.mockResolvedValue(null);
    runtime_platform.post_slack_message.mockClear();
    capture_product_event.mockClear();
  });

  it('says Slack and apps are not set up on an install that has neither key', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);

    const snapshot = await (await create_app(db).request('/v1/onboarding')).json();

    expect(snapshot.data.install).toMatchObject({
      slack_app_configured: false,
      app_provider_configured: false,
    });
    expect(
      snapshot.data.install.jobs_that_need_no_app.map((job: { name: string }) => job.name),
    ).toEqual([
      'A task on a schedule',
      'A page built from one sentence',
      'A weekly report from your files',
    ]);
  });

  it('sends the welcome once, and refuses to send it twice', async () => {
    runtime_platform.find_primary_member_channel.mockResolvedValue({
      id: 'C_GENERAL',
      name: 'general',
      is_private: false,
      is_member: true,
      num_members: 4,
    });
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    await db.insert(connections).values({
      connection_id: 'conn_slack_welcome',
      workspace_id: bootstrap.workspace_id,
      app_id: 'app_slack',
      connection_key: 'native:slack:conn_slack_welcome',
      connection_name: 'Slack',
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      provider_config_version: 1,
      connection_profile_key: 'native:slack:oauth_bot',
      connection_profile_version: 1,
      auth_method_key: 'slack_oauth2_bot',
      external_account_id: 'T123',
      external_account_name: 'Acme Slack',
      authorized_scopes: ['channels:read', 'chat:write'],
      health_status: 'healthy',
      credentials: { bot_token: 'xoxb-slack-test' },
      provider_account: {},
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    });

    const response = await app.request('/v1/onboarding/welcome', { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ sent: true, channel: 'general' });
    expect(runtime_platform.post_slack_message).toHaveBeenCalledTimes(1);
    const [, hello_channel, hello_text] = runtime_platform.post_slack_message.mock.calls[0] ?? [];
    expect(hello_channel).toBe('C_GENERAL');
    expect(hello_text).toContain("Hey everyone 👋 I'm Alfera");
    expect(hello_text).not.toContain('—');

    runtime_platform.post_slack_message.mockClear();
    const second = await app.request('/v1/onboarding/welcome', { method: 'POST' });
    expect((await second.json()).data.already_sent).toBe(true);
    expect(runtime_platform.post_slack_message).not.toHaveBeenCalled();
  });

  it('DMs the installer when no primary channel is available', async () => {
    runtime_platform.lookup_slack_user_id_by_email.mockResolvedValue('U_INSTALLER');
    runtime_platform.open_slack_dm_channel.mockResolvedValue('D_INSTALLER');
    runtime_platform.find_primary_member_channel.mockResolvedValue(null);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    await db.insert(connections).values({
      connection_id: 'conn_slack_dm_welcome',
      workspace_id: bootstrap.workspace_id,
      app_id: 'app_slack',
      connection_key: 'native:slack:conn_slack_dm_welcome',
      connection_name: 'Slack',
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      provider_config_version: 1,
      connection_profile_key: 'native:slack:oauth_bot',
      connection_profile_version: 1,
      auth_method_key: 'slack_oauth2_bot',
      external_account_id: 'T123',
      external_account_name: 'Acme Slack',
      authorized_scopes: ['channels:read', 'chat:write', 'users:read.email'],
      health_status: 'healthy',
      credentials: { bot_token: 'xoxb-slack-test' },
      provider_account: {},
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    });

    const response = await app.request('/v1/onboarding/welcome', { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ sent: true, dm_sent: true, channel: null });
    expect(runtime_platform.post_slack_message).toHaveBeenCalledWith(
      'xoxb-slack-test',
      'D_INSTALLER',
      expect.stringContaining('thanks for bringing me in'),
    );
  });

  it('reports the finished wizard once, on the completion that finished it', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await db
      .update(users)
      .set({ external_identity_id: 'user_workos_onboarding', first_name: 'Ada', last_name: 'King' })
      .where(eq(users.user_id, bootstrap.user_id));
    const app = create_app(db);

    expect((await app.request('/v1/onboarding/complete', { method: 'POST' })).status).toBe(200);

    expect(capture_product_event).toHaveBeenCalledTimes(1);
    expect(capture_product_event).toHaveBeenCalledWith({
      person: {
        distinct_id: 'user_workos_onboarding',
        email: 'founder@runtime.local',
        name: 'Ada King',
      },
      event: 'onboarding_completed',
      properties: { workspace_id: bootstrap.workspace_id },
    });

    capture_product_event.mockClear();
    expect((await app.request('/v1/onboarding/complete', { method: 'POST' })).status).toBe(200);
    expect(capture_product_event).not.toHaveBeenCalled();
  });

  it('reports nothing when the user has no WorkOS id', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    expect((await app.request('/v1/onboarding/complete', { method: 'POST' })).status).toBe(200);

    expect(capture_product_event).not.toHaveBeenCalled();
  });

  it('dev-skip is refused outside development', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    vi.resetModules();
    vi.doMock('@coworker/config', async () => {
      const actual = await vi.importActual<typeof import('@coworker/config')>('@coworker/config');
      return { ...actual, env: { ...actual.env, ENVIRONMENT: 'production' } };
    });
    const { create_app: create_production_app } = await import('@api/app');

    const response = await create_production_app(db).request('/v1/onboarding/dev-skip', {
      method: 'POST',
    });

    expect(response.status).toBe(404);
    const subscription = await db.query.subscriptions.findFirst({
      where: (table, { eq }) => eq(table.workspace_id, bootstrap.workspace_id),
    });
    expect(subscription).toBeUndefined();
    vi.doUnmock('@coworker/config');
    vi.resetModules();
  });
});
