import { createHmac } from 'node:crypto';
import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { record_notification_outcome } from '@coworker/core/db/queries/notification_outcomes';
import { create_session } from '@coworker/core/db/queries/sessions';
import { connections, event_jobs, events } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack_api = vi.hoisted(() => ({ lookup_email: vi.fn() }));
vi.mock('@runtime-platform/tools/slack/channels_api', async (import_actual) => ({
  ...(await import_actual<typeof import('@runtime-platform/tools/slack/channels_api')>()),
  lookup_slack_user_email: slack_api.lookup_email,
}));

const runtime = vi.hoisted(() => ({
  start_agent_run: vi.fn(async (_db: unknown, _input: StartAgentRunInput) => ({
    run_id: 'run_from_the_press',
  })),
}));
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', async (import_actual) => ({
  ...(await import_actual<typeof import('@runtime-platform/orchestrator/runtime_orchestrator')>()),
  start_agent_run: runtime.start_agent_run,
}));

const signing_secret = 'slack-notification-click-test-secret';

describe('answering a notification from a Slack button', () => {
  afterEach(() => {
    slack_api.lookup_email.mockReset();
    runtime.start_agent_run.mockClear();
    vi.unstubAllEnvs();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('says yes in the chat the notification came out of, and closes it as acted', async () => {
    const fixture = await create_fixture();
    slack_api.lookup_email.mockResolvedValue(fixture.email);

    const response = await press(fixture, 'notification_yes');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      replace_original: true,
      text: '✓ Yes — on it.',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*A new Attio lead*' } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '✓ Yes — on it.' }] },
      ],
    });
    expect(await read_answers(fixture)).toEqual([
      {
        event_type: 'notification.answered',
        source_event_id: `${fixture.notification_event_id}:answer`,
        queue_key: `session:${fixture.session_id}`,
        event_body: {
          notification_event_id: fixture.notification_event_id,
          session_id: fixture.session_id,
          answered_by: fixture.user_id,
          answer: 'yes',
        },
      },
    ]);
    expect(await read_answer_jobs(fixture)).toEqual([
      {
        job_handler: 'notification_answer',
        queue_key: `session:${fixture.session_id}`,
      },
    ]);
    expect(await read_follow_ups(fixture)).toEqual(['notification.acted']);

    await wait_for_the_answer_job_to_finish(fixture);
    expect(runtime.start_agent_run).toHaveBeenCalledTimes(1);
    expect(runtime.start_agent_run.mock.calls[0]?.[1]).toMatchObject({
      workspace_id: fixture.workspace_id,
      session_id: fixture.session_id,
      user_message: 'Yes, go ahead.',
      actor_id: fixture.user_id,
    });
  });

  it('answers once when Yes is pressed twice', async () => {
    const fixture = await create_fixture();
    slack_api.lookup_email.mockResolvedValue(fixture.email);

    await press(fixture, 'notification_yes');
    const second = await press(fixture, 'notification_yes');

    expect(second.status).toBe(200);
    expect(await read_answers(fixture)).toHaveLength(1);
    expect(await read_answer_jobs(fixture)).toHaveLength(1);
    await wait_for_the_answer_job_to_finish(fixture);
    expect(runtime.start_agent_run).toHaveBeenCalledTimes(1);
  });

  it('drops it on No, and starts nothing', async () => {
    const fixture = await create_fixture();
    slack_api.lookup_email.mockResolvedValue(fixture.email);

    const response = await press(fixture, 'notification_no');

    expect(await response.json()).toMatchObject({ text: 'Noted, dropped.' });
    expect(runtime.start_agent_run).not.toHaveBeenCalled();
    expect(await read_follow_ups(fixture)).toEqual(['notification.dismissed']);
  });

  it('refuses a press from somebody who is not in the workspace', async () => {
    const fixture = await create_fixture();
    slack_api.lookup_email.mockResolvedValue('a-stranger@example.test');

    const response = await press(fixture, 'notification_yes');

    expect(await response.json()).toMatchObject({
      text: 'Only somebody in this workspace can answer this — open Alfera to check.',
    });
    expect(runtime.start_agent_run).not.toHaveBeenCalled();
    expect(await read_follow_ups(fixture)).toEqual([]);
  });

  it('says so when the notification is gone', async () => {
    const fixture = await create_fixture();
    slack_api.lookup_email.mockResolvedValue(fixture.email);

    const response = await post(fixture, block_actions_payload('evt_nothing', 'notification_yes'));

    expect(await response.json()).toMatchObject({
      text: 'That is not here anymore. Open Alfera to check.',
    });
    expect(runtime.start_agent_run).not.toHaveBeenCalled();
  });
});

function press(fixture: Fixture, action_id: string) {
  return post(fixture, block_actions_payload(fixture.notification_event_id, action_id));
}

function block_actions_payload(value: string, action_id: string) {
  return {
    type: 'block_actions',
    team: { id: 'T777' },
    user: { id: 'U777' },
    actions: [{ action_id, value }],
    message: {
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*A new Attio lead*' } },
        { type: 'actions', elements: [{ type: 'button', action_id, value }] },
      ],
    },
  };
}

function post(fixture: Fixture, payload: unknown) {
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `v0=${createHmac('sha256', signing_secret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;
  return fixture.app.request('/v1/channels/slack/interactivity', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
    body,
  });
}

async function read_follow_ups(fixture: Fixture) {
  const rows = await fixture.db.query.events.findMany({
    where: and(eq(events.workspace_id, fixture.workspace_id), eq(events.source, 'notification')),
  });
  return rows
    .map((row) => row.event_type)
    .filter(
      (event_type) =>
        event_type !== 'notification.notify_now' && event_type !== 'notification.answered',
    );
}

async function read_answers(fixture: Fixture) {
  const rows = await fixture.db.query.events.findMany({
    where: and(
      eq(events.workspace_id, fixture.workspace_id),
      eq(events.event_type, 'notification.answered'),
    ),
  });
  return rows.map(({ event_type, source_event_id, queue_key, event_body }) => ({
    event_type,
    source_event_id,
    queue_key,
    event_body,
  }));
}

function wait_for_the_answer_job_to_finish(fixture: Fixture) {
  return vi.waitFor(
    async () => {
      const job = await fixture.db.query.event_jobs.findFirst({
        where: eq(event_jobs.job_handler, 'notification_answer'),
      });
      expect(job?.job_status).toBe('done');
    },
    { timeout: 5_000, interval: 50 },
  );
}

async function read_answer_jobs(fixture: Fixture) {
  const rows = await fixture.db.query.event_jobs.findMany({
    where: and(
      eq(event_jobs.workspace_id, fixture.workspace_id),
      eq(event_jobs.job_handler, 'notification_answer'),
    ),
  });
  return rows.map(({ job_handler, queue_key }) => ({ job_handler, queue_key }));
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

async function create_fixture() {
  vi.stubEnv('SLACK_SIGNING_SECRET', signing_secret);
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'notification-click-test-key';
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq: is }) => is(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app seed missing');
  await db.insert(connections).values({
    connection_id: 'conn_slack_notification_click',
    workspace_id: bootstrap.workspace_id,
    app_id: slack_app.app_id,
    connection_name: 'Slack notification click test',
    connection_status: 'active',
    connection_key: 'native:slack:notification_click',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T777',
    external_account_name: 'Click test workspace',
    authorized_scopes: ['chat:write', 'users:read.email'],
    health_status: 'healthy',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'xoxb-click' },
    }),
    provider_account: { team_id: 'T777', bot_user_id: 'B777' },
    metadata: {},
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
  const written = await record_notification_outcome(db, {
    workspace_id: bootstrap.workspace_id,
    subject: 'the Attio lead',
    fingerprint: 'fingerprint_attio_lead',
    outcome: 'notify_now',
    actor_id: bootstrap.user_id,
    notification: {
      agent_id: bootstrap.agent_id,
      automation_id: null,
      run_id: 'run_attio',
      session_id: session.session_id,
      principal_id: bootstrap.user_id,
      title: 'A new Attio lead',
      body: 'Shall I write the intro mail?',
      urgency: 'deadline',
      score: 80,
      outcome_reason: '80 is above the bar',
      policy_hash: 'default',
      evidence: { event_ids: ['evt_1'], brain_slugs: [], run_ids: [], message_refs: [] },
      proposed_action: {
        kind: 'offer_to_act',
        instruction: 'write the intro mail',
        needs_apps: [],
      },
      delivered_on: 'slack_dm',
      delivery_ref: 'D1:1.2',
      delivery_error: null,
      expires_time: null,
      metadata: { score_reason: 'a lead nobody has answered' },
    },
  });
  if (!written) throw new Error('the ledger refused the fixture notification');
  const user = await db.query.users.findFirst({
    where: (table, { eq: is }) => is(table.user_id, bootstrap.user_id),
  });

  return {
    db,
    app: create_app(db),
    workspace_id: bootstrap.workspace_id,
    user_id: bootstrap.user_id,
    session_id: session.session_id,
    notification_event_id: written.event_id,
    email: user?.email,
  };
}
