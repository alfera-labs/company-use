import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { connections, event_jobs } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack_posts: Array<{ channel: string; text: string }> = [];

vi.mock('@runtime-platform/tools/slack/channels_api', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/tools/slack/channels_api')>();
  return {
    ...actual,
    find_primary_member_channel: async () => ({ id: 'C_SUPPORT', name: 'support' }),
    post_slack_message: async (_token: string, channel: string, text: string) => {
      slack_posts.push({ channel, text });
      return { ok: true };
    },
  };
});

import { start_workspace_discovery_run } from '@runtime-platform/events/workspace_discovery_run';

const workspace_id = 'ws_1';

describe('workspace discovery run', () => {
  beforeEach(() => {
    slack_posts.length = 0;
  });

  it('announces in the primary channel and enqueues the discovery sweep', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);

    const result = await start_workspace_discovery_run(db, {
      workspace_id,
      actor_id: 'user_1',
    });

    expect(result).toMatchObject({
      started: true,
      discovery_run_key: 'first-contact',
      notification_channel_id: 'C_SUPPORT',
      notification_channel_source: 'primary_member_channel',
      channel: 'support',
    });
    expect(slack_posts).toEqual([
      {
        channel: 'C_SUPPORT',
        text: [
          "Hey everyone 👋 I'm Alfera.",
          "Give me a couple of minutes, I'm reading through the channels to see how things run here 👀",
        ].join('\n\n'),
      },
    ]);
    const queued = await db.query.event_jobs.findMany({
      where: eq(event_jobs.job_handler, 'slack_discovery'),
    });
    expect(queued).toHaveLength(1);
  });

  it('stays quiet at the start when the caller already said hello', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);

    const result = await start_workspace_discovery_run(db, {
      workspace_id,
      actor_id: 'user_1',
      announce_start: false,
    });

    expect(result.started).toBe(true);
    expect(slack_posts).toEqual([]);
  });

  it('a second trigger starts no second sweep and announces nothing', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);

    const first = await start_workspace_discovery_run(db, { workspace_id, actor_id: 'user_1' });
    const second = await start_workspace_discovery_run(db, {
      workspace_id,
      actor_id: 'system:discovery',
    });

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.reason).toBe('already_ran');
    const queued = await db.query.event_jobs.findMany({
      where: eq(event_jobs.job_handler, 'slack_discovery'),
    });
    expect(queued).toHaveLength(1);
    expect(slack_posts).toHaveLength(1);
  });

  it('reports slack_not_connected without posting when no connection exists', async () => {
    const db = await create_test_database();

    const result = await start_workspace_discovery_run(db, { workspace_id, actor_id: 'user_1' });

    expect(result).toEqual({ started: false, reason: 'slack_not_connected' });
    expect(slack_posts).toHaveLength(0);
  });

  it('a silent run enqueues the sweep without announcing', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);

    const result = await start_workspace_discovery_run(db, {
      workspace_id,
      actor_id: 'system:discovery',
      delivery_mode: 'silent',
    });

    expect(result).toMatchObject({
      started: true,
      delivery_mode: 'silent',
      notification_channel_id: null,
    });
    expect(slack_posts).toHaveLength(0);
  });
});

async function seed_slack_connection(db: Awaited<ReturnType<typeof create_test_database>>) {
  await db.insert(connections).values({
    connection_id: 'conn_discovery_slack',
    workspace_id,
    app_id: 'app_slack_test',
    connection_name: 'Slack discovery test',
    connection_status: 'active',
    connection_key: 'native:slack:discovery-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T123',
    external_account_name: 'Test workspace',
    authorized_scopes: ['channels:history', 'channels:read', 'chat:write'],
    health_status: 'healthy',
    credentials: { bot_token: 'slack-discovery-test-token' },
    provider_account: { team_id: 'T123', app_id: 'A_LOCAL', bot_user_id: 'B123' },
    metadata: {},
    created_by: 'user_1',
    last_updated_by: 'user_1',
  });
}
