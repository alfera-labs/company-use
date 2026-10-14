import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { connections, event_jobs, events } from '@coworker/core/db/schema';
import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';
import { prepare_slack_channel_event_jobs } from '@runtime-platform/channels/slack/channel_event_queue';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  native_trigger_node_keys,
  seed_native_trigger_catalog,
} from '@runtime-platform/tools/native_trigger_seed';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const team_id = 'T_EARS';
const watched_channel = 'C_BUGS';

describe('the workspace Slack app as an automation ear', () => {
  it('fires on a message nobody addressed, keyed on the channel thread', async () => {
    const fixture = await create_fixture();

    await prepare_slack_channel_event_jobs(
      fixture.db,
      slack_event({ event_id: 'Ev_1', ts: '1700000000.000100', text: 'checkout is down' }),
      no_reaction,
    );

    const fires = await read_trigger_fires(fixture.db, fixture.workspace_id);
    expect(fires).toHaveLength(1);
    expect(fires[0]?.queue_key).toBe(
      `automation:${fixture.automation_id}:subject:${watched_channel}:1700000000.000100`,
    );
    expect(
      (fires[0]?.event_body as { delivery: { data: Record<string, unknown> } }).delivery.data,
    ).toMatchObject({
      thread_id: `${watched_channel}:1700000000.000100`,
      channel_id: watched_channel,
      channel_type: 'channel',
      user_id: 'U_PERSON',
      text: 'checkout is down',
      ts: '1700000000.000100',
      is_thread_reply: false,
      is_mention: false,
    });
    expect(await read_automation_jobs(fixture.db, fixture.workspace_id)).toHaveLength(1);
  });

  it('keeps the thread root as the subject, so a reply lands in the same session', async () => {
    const fixture = await create_fixture();

    await prepare_slack_channel_event_jobs(
      fixture.db,
      slack_event({
        event_id: 'Ev_reply',
        ts: '1700000009.000100',
        thread_ts: '1700000000.000100',
        text: 'still broken',
      }),
      no_reaction,
    );

    const [fire] = await read_trigger_fires(fixture.db, fixture.workspace_id);
    expect(
      (fire?.event_body as { delivery: { data: Record<string, unknown> } }).delivery.data,
    ).toMatchObject({
      thread_id: `${watched_channel}:1700000000.000100`,
      is_thread_reply: true,
    });
  });

  it('says nothing when the message came from a bot', async () => {
    const fixture = await create_fixture();

    await prepare_slack_channel_event_jobs(
      fixture.db,
      slack_event({
        event_id: 'Ev_bot',
        ts: '1700000001.000100',
        text: 'deploy finished',
        bot_id: 'B_DEPLOY',
      }),
      no_reaction,
    );

    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(0);
  });

  it('fires once when Slack delivers the same message twice', async () => {
    const fixture = await create_fixture();
    const message = { ts: '1700000002.000100', text: '<@B1> the checkout is throwing a 500' };

    await prepare_slack_channel_event_jobs(
      fixture.db,
      slack_event({ ...message, event_id: 'Ev_2' }),
      no_reaction,
    );
    await prepare_slack_channel_event_jobs(
      fixture.db,
      slack_event({ ...message, event_id: 'Ev_2' }),
      no_reaction,
    );
    await prepare_slack_channel_event_jobs(
      fixture.db,
      slack_event({ ...message, event_id: 'Ev_3', type: 'app_mention' }),
      no_reaction,
    );

    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(1);
    expect(await read_automation_jobs(fixture.db, fixture.workspace_id)).toHaveLength(1);
  });

  it('stays deaf when the ear is set up for another channel', async () => {
    const fixture = await create_fixture({ channel_id: 'C_SOMEWHERE_ELSE' });

    await prepare_slack_channel_event_jobs(
      fixture.db,
      slack_event({ event_id: 'Ev_4', ts: '1700000003.000100', text: 'checkout is down' }),
      no_reaction,
    );

    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(0);
  });
});

const no_reaction = { add_reaction: async () => {} };

function slack_event(input: {
  event_id: string;
  ts: string;
  text: string;
  thread_ts?: string;
  bot_id?: string;
  type?: string;
}): VerifiedChannelEvent {
  const type = input.type ?? 'message';
  return {
    channel_provider_key: 'slack',
    provider_event_id: input.event_id,
    received_time: new Date('2026-06-01T10:00:00.000Z'),
    external_account_id: team_id,
    provider_event_type: type,
    raw_event: {
      type: 'event_callback',
      team_id,
      event_id: input.event_id,
      event: {
        type,
        channel: watched_channel,
        channel_type: 'channel',
        user: 'U_PERSON',
        ts: input.ts,
        text: input.text,
        ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
        ...(input.bot_id ? { bot_id: input.bot_id } : {}),
      },
    },
  };
}

function read_trigger_fires(db: Database, workspace_id: string) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.workspace_id, workspace_id), eq(events.event_type, 'trigger.fired')));
}

function read_automation_jobs(db: Database, workspace_id: string) {
  return db
    .select()
    .from(event_jobs)
    .where(
      and(eq(event_jobs.workspace_id, workspace_id), eq(event_jobs.job_handler, 'run_automation')),
    );
}

async function create_fixture(setup: { channel_id?: string } = {}) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  await seed_native_trigger_catalog(db);
  await connect_the_slack_app(db, bootstrap.workspace_id, bootstrap.user_id);

  const automation = await create_automation(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_name: 'Slack bug watch',
    instruction: 'Summarize what broke.',
    run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
    conditions: [],
    judge: null,
    actor_id: bootstrap.user_id,
  });
  const trigger = await create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_id: automation.automation_id,
    trigger_name: 'Someone writes in Slack',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      event_source: {
        node_key: native_trigger_node_keys.slack_message,
        ...(setup.channel_id ? { subscription_config: { channel_id: setup.channel_id } } : {}),
      },
    },
    trigger_status: 'enabled',
    actor_id: bootstrap.user_id,
  });

  return {
    db,
    workspace_id: bootstrap.workspace_id,
    automation_id: automation.automation_id,
    trigger_id: trigger.trigger_id,
  };
}

async function connect_the_slack_app(db: Database, workspace_id: string, user_id: string) {
  await db.insert(connections).values({
    connection_id: 'conn_slack_ears',
    workspace_id,
    app_id: 'app_test',
    connection_name: 'Slack',
    connection_status: 'active',
    connection_key: 'native:slack:conn_slack_ears',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: team_id,
    external_account_name: 'Test team',
    authorized_scopes: [],
    health_status: 'healthy',
    credentials: { bot_token: 'token' },
    provider_account: { team_id, bot_user_id: 'B1' },
    metadata: {},
    created_by: user_id,
    last_updated_by: user_id,
  });
}
