import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { seed_runtime_tool_catalog } from '@coworker/runtime-platform';
import { scout_config_key, scout_job_handler } from '@coworker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@runtime-platform/tools/slack/channels_api', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/tools/slack/channels_api')>();
  return { ...actual, find_primary_member_channel: async () => null };
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

describe('connecting Slack and the scout trigger', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SLACK_CLIENT_ID;
    delete process.env.SLACK_CLIENT_SECRET;
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('answers the native Slack OAuth callback with the scout trigger', async () => {
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_test';
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'slack-route-test-key';
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
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

    expect(callback_body.scout_trigger).toMatchObject({
      trigger_type: 'schedule',
      trigger_status: 'enabled',
      trigger_config: {
        starts_job_handler: scout_job_handler,
        [scout_config_key]: { version: 1, mode: 'autonomous_agent' },
      },
    });
  });
});
