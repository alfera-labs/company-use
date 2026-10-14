import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { connections } from '@coworker/core/db/schema';
import { event_job_queue_barrier_metadata_key } from '@coworker/jobs';
import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';
import { prepare_slack_channel_event_jobs } from '@runtime-platform/channels/slack/channel_event_queue';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('prepare_slack_channel_event_jobs auto-release', () => {
  it.each([
    'app_uninstalled',
    'app_uninstalled_team',
    'tokens_revoked',
  ])('releases the team claim when Slack reports %s', async (event_type) => {
    const db = await create_test_database();
    await seed_active_slack_connection(db, { connection_id: 'conn_owner', team_id: 'T_GONE' });

    const result = await prepare_slack_channel_event_jobs(db, slack_control_event(event_type));

    expect(result?.event_status).toBe('ignored');
    const row = await db.query.connections.findFirst({
      where: eq(connections.connection_id, 'conn_owner'),
    });
    expect(row?.connection_status).toBe('revoked');
  });

  it('is a no-op when the team has no active connection (idempotent re-delivery)', async () => {
    const db = await create_test_database();

    const result = await prepare_slack_channel_event_jobs(
      db,
      slack_control_event('app_uninstalled'),
    );

    expect(result).toBeNull();
  });

  it('leaves the connection active for ordinary message events', async () => {
    const db = await create_test_database();
    await seed_active_slack_connection(db, { connection_id: 'conn_owner', team_id: 'T_LIVE' });

    await prepare_slack_channel_event_jobs(db, {
      channel_provider_key: 'slack',
      provider_event_id: 'Ev1',
      received_time: new Date('2026-06-01T10:00:00.000Z'),
      external_account_id: 'T_LIVE',
      provider_event_type: 'message',
      raw_event: {
        type: 'event_callback',
        team_id: 'T_LIVE',
        event_id: 'Ev1',
        event: { type: 'message', channel: 'C1', user: 'U1', ts: '1700000000.0001', text: 'hi' },
      },
    });

    const row = await db.query.connections.findFirst({
      where: eq(connections.connection_id, 'conn_owner'),
    });
    expect(row?.connection_status).toBe('active');
  });
});

describe('prepare_slack_channel_event_jobs subject keys', () => {
  it('serializes each Slack thread while allowing distinct top-level messages to run concurrently', async () => {
    const db = await create_test_database();
    await seed_active_slack_connection(db, {
      connection_id: 'conn_subjects',
      team_id: 'T_SUBJECT',
    });

    const first_top_level = await prepare_slack_channel_event_jobs(
      db,
      slack_message_event({ team_id: 'T_SUBJECT', event_ts: '1700000000.000001' }),
      { add_reaction: async () => {} },
    );
    const second_top_level = await prepare_slack_channel_event_jobs(
      db,
      slack_message_event({ team_id: 'T_SUBJECT', event_ts: '1700000001.000001' }),
      { add_reaction: async () => {} },
    );
    const first_reply = await prepare_slack_channel_event_jobs(
      db,
      slack_message_event({
        team_id: 'T_SUBJECT',
        event_ts: '1700000002.000001',
        thread_ts: '1700000000.000001',
      }),
      { add_reaction: async () => {} },
    );
    const second_reply = await prepare_slack_channel_event_jobs(
      db,
      slack_message_event({
        team_id: 'T_SUBJECT',
        event_ts: '1700000003.000001',
        thread_ts: '1700000000.000001',
      }),
      { add_reaction: async () => {} },
    );

    expect(first_top_level?.queue_key).toBe('slack:T_SUBJECT:C_SUBJECT:thread:1700000000.000001');
    expect(second_top_level?.queue_key).toBe('slack:T_SUBJECT:C_SUBJECT:thread:1700000001.000001');
    expect(first_top_level?.queue_key).not.toBe(second_top_level?.queue_key);
    expect(first_reply?.queue_key).toBe('slack:T_SUBJECT:C_SUBJECT:thread:1700000000.000001');
    expect(second_reply?.queue_key).toBe(first_reply?.queue_key);
    expect(first_reply?.queue_key).toBe(first_top_level?.queue_key);
    expect(first_top_level?.event_jobs).toEqual([
      expect.objectContaining({
        job_handler: 'slack_agent_message',
        metadata: { [event_job_queue_barrier_metadata_key]: true },
      }),
    ]);
  });
});

describe('prepare_slack_channel_event_jobs reaction does not block the ACK', () => {
  it('routes and returns the event without waiting for the ⏱️ reaction to post', async () => {
    const db = await create_test_database();
    await seed_active_slack_connection(db, { connection_id: 'conn_ack', team_id: 'T_ACK' });

    let reaction_started = false;
    const never_resolving_reaction = new Promise<void>(() => {});

    const result = await prepare_slack_channel_event_jobs(
      db,
      slack_message_event({ team_id: 'T_ACK', event_ts: '1700000030.000001' }),
      {
        add_reaction: () => {
          reaction_started = true;
          return never_resolving_reaction;
        },
      },
    );

    expect(result?.event_status).toBe('routed');
    expect(reaction_started).toBe(true);
  });

  it('does not claim an unmentioned thread reply before the agent judges its audience', async () => {
    const db = await create_test_database();
    await seed_active_slack_connection(db, { connection_id: 'conn_reply', team_id: 'T_REPLY' });
    const event = slack_message_event({
      team_id: 'T_REPLY',
      event_ts: '1700000031.000001',
      thread_ts: '1700000030.000001',
    });
    const body = event.raw_event as { event: Record<string, unknown> };
    body.event = { ...body.event, type: 'message', text: 'hey otto' };
    let reaction_started = false;

    const result = await prepare_slack_channel_event_jobs(db, event, {
      add_reaction: async () => {
        reaction_started = true;
      },
    });

    expect(result?.event_status).toBe('routed');
    expect(reaction_started).toBe(false);
  });
});

describe('prepare_slack_channel_event_jobs message subtypes', () => {
  it('queues a thread reply that carries an uploaded file (subtype file_share)', async () => {
    const db = await create_test_database();
    await seed_active_slack_connection(db, { connection_id: 'conn_files', team_id: 'T_FILES' });

    const file_share_event = slack_message_event({
      team_id: 'T_FILES',
      event_ts: '1700000010.000001',
      thread_ts: '1700000009.000001',
    });
    const raw_body = file_share_event.raw_event as { event: Record<string, unknown> };
    raw_body.event = {
      ...raw_body.event,
      type: 'message',
      subtype: 'file_share',
      text: 'here is the screenshot',
    };

    const result = await prepare_slack_channel_event_jobs(db, file_share_event, {
      add_reaction: async () => {},
    });

    expect(result?.event_status).not.toBe('ignored');
    expect(result?.queue_key).toBe('slack:T_FILES:C_SUBJECT:thread:1700000009.000001');
  });

  it('still ignores other message subtypes', async () => {
    const db = await create_test_database();
    await seed_active_slack_connection(db, { connection_id: 'conn_joins', team_id: 'T_JOINS' });

    const join_event = slack_message_event({
      team_id: 'T_JOINS',
      event_ts: '1700000020.000001',
      thread_ts: '1700000019.000001',
    });
    const raw_body = join_event.raw_event as { event: Record<string, unknown> };
    raw_body.event = { ...raw_body.event, type: 'message', subtype: 'channel_join' };

    const result = await prepare_slack_channel_event_jobs(db, join_event, {
      add_reaction: async () => {},
    });

    expect(result?.event_status).toBe('ignored');
    expect(result?.metadata).toMatchObject({ ignored_reason: 'message_subtype_ignored' });
  });
});

function slack_control_event(event_type: string): VerifiedChannelEvent {
  return {
    channel_provider_key: 'slack',
    provider_event_id: `Ev_${event_type}`,
    received_time: new Date('2026-06-01T10:00:00.000Z'),
    external_account_id: 'T_GONE',
    provider_event_type: event_type,
    raw_event: {
      type: 'event_callback',
      team_id: 'T_GONE',
      event_id: `Ev_${event_type}`,
      event: { type: event_type },
    },
  };
}

function slack_message_event(input: {
  team_id: string;
  event_ts: string;
  thread_ts?: string;
}): VerifiedChannelEvent {
  return {
    channel_provider_key: 'slack',
    provider_event_id: `Ev_${input.event_ts}`,
    received_time: new Date('2026-06-01T10:00:00.000Z'),
    external_account_id: input.team_id,
    provider_event_type: 'app_mention',
    raw_event: {
      type: 'event_callback',
      team_id: input.team_id,
      event_id: `Ev_${input.event_ts}`,
      event: {
        type: 'app_mention',
        channel: 'C_SUBJECT',
        channel_type: 'channel',
        user: 'U_SUBJECT',
        ts: input.event_ts,
        ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
        text: '<@B1> hello',
      },
    },
  };
}

async function seed_active_slack_connection(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: { connection_id: string; team_id: string },
) {
  await db.insert(connections).values({
    connection_id: input.connection_id,
    workspace_id: 'ws_owner',
    app_id: 'app_test',
    connection_name: input.connection_id,
    connection_status: 'active',
    connection_key: `native:slack:${input.connection_id}`,
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: input.team_id,
    external_account_name: 'Test team',
    authorized_scopes: [],
    health_status: 'healthy',
    credentials: { bot_token: 'token' },
    provider_account: { team_id: input.team_id, bot_user_id: 'B1' },
    metadata: {},
    created_by: 'user_test',
    last_updated_by: 'user_test',
  });
}
