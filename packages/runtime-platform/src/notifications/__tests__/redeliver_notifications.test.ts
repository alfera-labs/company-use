import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  find_notification,
  type RecordNotificationOutcomeInput,
  record_notification_outcome,
  set_notification_delivery,
} from '@coworker/core/db/queries/notification_outcomes';
import { connections, events } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({
  lookup_slack_user_id_by_email: vi.fn(async () => 'U_owner' as string | null),
  open_slack_dm_channel: vi.fn(async () => 'D_owner' as string | undefined),
  post_slack_message: vi.fn(
    async (_token: string, _channel: string, _text: string, _options?: unknown) =>
      '1726400000.0001' as string | undefined,
  ),
}));
vi.mock('@runtime-platform/tools/slack/channels_api', () => ({
  ...slack,
  read_slack_bot_token: (connection: unknown) => (connection ? 'xoxb-test' : null),
}));

const { redeliver_undelivered_notifications } = await import(
  '@runtime-platform/notifications/redeliver_notifications'
);

describe('re-driving an notification nobody received', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('records why a stranded notification still reached nobody', async () => {
    const fixture = await create_fixture();
    const stranded = await write_row(fixture, { minutes_ago: 30 });

    const redelivered = await redeliver_undelivered_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      actor_id: 'system:automation_watchdog',
    });

    expect(redelivered).toEqual([{ notification_event_id: stranded.event_id, delivered_on: null }]);
    const row = await read_row(fixture.db, fixture.workspace_id, stranded.event_id);
    expect(row?.notification.delivered_on).toBeNull();
    expect(row?.notification.delivery_error).toContain('slack_dm: no way to reach them');
    expect(row?.notification.metadata.redelivered_time).toEqual(expect.any(String));
  });

  it('saves its marker before it sends, and sends a question as the card again', async () => {
    const fixture = await create_fixture();
    await connect_slack(fixture);
    const stranded = await write_row(fixture, {
      minutes_ago: 30,
      session_id: 'ses_owner',
      proposed_action: { kind: 'offer_to_act', instruction: 'answer the customer', needs_apps: [] },
    });
    let marker_at_send: unknown = null;
    slack.post_slack_message.mockImplementationOnce(async () => {
      const row = await read_row(fixture.db, fixture.workspace_id, stranded.event_id);
      marker_at_send = row?.notification.metadata.redelivered_time ?? null;
      return '1726400000.0001';
    });

    const redelivered = await redeliver_undelivered_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      actor_id: 'system:automation_watchdog',
    });

    expect(redelivered).toEqual([
      { notification_event_id: stranded.event_id, delivered_on: 'slack_dm' },
    ]);
    expect(marker_at_send).toEqual(expect.any(String));
    const options = slack.post_slack_message.mock.calls[0]?.[3] as { blocks?: unknown[] };
    expect(JSON.stringify(options.blocks)).toContain(stranded.event_id);
  });

  it('leaves a fresh one alone, and never re-drives the same row twice', async () => {
    const fixture = await create_fixture();
    await write_row(fixture, { minutes_ago: 2 });
    const stranded = await write_row(fixture, { minutes_ago: 30, subject: 'second' });

    await redeliver_undelivered_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      actor_id: 'system:automation_watchdog',
    });
    await set_notification_delivery(fixture.db, {
      workspace_id: fixture.workspace_id,
      event_id: stranded.event_id,
      actor_id: 'system:test',
      delivery: { delivered_on: null, delivery_ref: null, delivery_error: 'the channel was down' },
    });

    const second_sweep = await redeliver_undelivered_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      actor_id: 'system:automation_watchdog',
    });

    expect(second_sweep).toEqual([]);
  });

  it('leaves a delivered notification alone', async () => {
    const fixture = await create_fixture();
    await write_row(fixture, { minutes_ago: 30, delivered_on: 'slack_dm' });

    const redelivered = await redeliver_undelivered_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      actor_id: 'system:automation_watchdog',
    });

    expect(redelivered).toEqual([]);
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return {
    db,
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    user_id: bootstrap.user_id,
  };
}

async function write_row(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  options: {
    minutes_ago: number;
    subject?: string;
    delivered_on?: string;
    session_id?: string;
    proposed_action?: RecordNotificationOutcomeInput['notification']['proposed_action'];
  },
) {
  const input: RecordNotificationOutcomeInput = {
    workspace_id: fixture.workspace_id,
    subject: options.subject ?? 'first',
    fingerprint: `fingerprint_${options.subject ?? 'first'}`,
    outcome: 'notify_now',
    actor_id: fixture.user_id,
    notification: {
      agent_id: fixture.agent_id,
      automation_id: null,
      run_id: 'run_stranded',
      session_id: options.session_id ?? null,
      principal_id: fixture.user_id,
      title: 'The customer asked for an answer today',
      body: 'They need a yes or no before six.',
      urgency: 'deadline',
      score: 90,
      outcome_reason: '90 is above the bar',
      policy_hash: 'default',
      evidence: { event_ids: [], brain_slugs: [], run_ids: [], message_refs: ['msg_1'] },
      proposed_action: options.proposed_action ?? { kind: 'none' },
      delivered_on: options.delivered_on ?? null,
      delivery_ref: null,
      delivery_error: null,
      expires_time: null,
      metadata: { score_reason: 'they named a time' },
    },
  };
  const row = await record_notification_outcome(fixture.db, input);
  if (!row) throw new Error('the ledger refused the fixture row');

  await fixture.db
    .update(events)
    .set({ created_time: new Date(Date.now() - options.minutes_ago * 60_000) })
    .where(eq(events.event_id, row.event_id));
  return row;
}

async function connect_slack(fixture: Awaited<ReturnType<typeof create_fixture>>) {
  await seed_runtime_tool_catalog(fixture.db);
  const slack_app = await fixture.db.query.apps.findFirst({
    where: (table, { eq: is }) => is(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app seed missing');
  await fixture.db.insert(connections).values({
    connection_id: 'con_slack',
    workspace_id: fixture.workspace_id,
    app_id: slack_app.app_id,
    connection_name: 'Slack delivery test',
    connection_key: 'native:slack:delivery',
    connection_status: 'active',
    provider_key: native_slack_provider_key,
    provider_config_key: native_slack_provider_config_key,
    connection_profile_key: native_slack_connection_profile_key,
    auth_method_key: 'slack_oauth2_bot',
    provider_account: { team_id: 'T1', bot_user_id: 'B1' },
    created_by: 'system:test',
    last_updated_by: 'system:test',
  });
}

function read_row(db: Database, workspace_id: string, event_id: string) {
  return find_notification(db, { workspace_id, event_id });
}
