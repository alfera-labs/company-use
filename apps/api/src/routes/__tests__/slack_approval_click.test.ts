import { createHmac } from 'node:crypto';
import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_tool_policy_wait } from '@coworker/core/db/queries/event_waits';
import { set_policy } from '@coworker/core/db/queries/policies';
import {
  create_run,
  create_session,
  create_tool_call_started,
} from '@coworker/core/db/queries/sessions';
import { connections, event_jobs, events, policies } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_tool_batch_policy } from '@runtime-platform/tools/policies/tool_batch_policy';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack_api = vi.hoisted(() => ({ lookup_email: vi.fn() }));

vi.mock('@runtime-platform/tools/slack/channels_api', async (import_actual) => ({
  ...(await import_actual<typeof import('@runtime-platform/tools/slack/channels_api')>()),
  lookup_slack_user_email: slack_api.lookup_email,
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = { lookupByEmail: () => Promise.reject(new Error('users_not_found')) };
    conversations = { open: () => Promise.resolve({ ok: false }) };
    chat = { postMessage: () => Promise.resolve({ ok: true, ts: '1.2' }) };
  },
}));

const signing_secret = 'slack-approval-click-test-secret';

describe('deciding an approval from a Slack button', () => {
  afterEach(() => {
    slack_api.lookup_email.mockReset();
    vi.unstubAllEnvs();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('records the answer an eligible person pressed, and lets the run go on', async () => {
    const fixture = await create_fixture();
    answer_the_email_lookup(fixture.email);

    const response = await press(fixture, 'approval_approve');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      response_type: 'ephemeral',
      replace_original: false,
      text: '✓ Approved by <@U777> — the agent is continuing.',
    });
    expect(await read_decisions(fixture)).toEqual([
      { job_id: fixture.job_id, decision: 'approved' },
    ]);
    expect(await read_wait_status(fixture)).not.toBe('waiting');
  });

  it('decides nothing when the Slack account is not somebody this was asked of', async () => {
    const fixture = await create_fixture();
    answer_the_email_lookup('a-stranger@example.test');

    const response = await press(fixture, 'approval_approve');

    expect(await response.json()).toMatchObject({
      text: 'Only somebody this was asked of can answer it — open Alfera to check.',
    });
    expect(await read_decisions(fixture)).toEqual([]);
    expect(await read_wait_status(fixture)).toBe('waiting');
  });

  it('answers a second press without deciding twice', async () => {
    const fixture = await create_fixture();
    answer_the_email_lookup(fixture.email);

    await press(fixture, 'approval_approve');
    const second = await press(fixture, 'approval_refuse');

    expect(await second.json()).toMatchObject({ text: 'Somebody already answered this one.' });
    expect(await read_decisions(fixture)).toEqual([
      { job_id: fixture.job_id, decision: 'approved' },
    ]);
  });

  it('stops asking about the tool when Always allow is pressed', async () => {
    const fixture = await create_fixture();
    answer_the_email_lookup(fixture.email);
    await ask_before_every_tool(fixture);
    expect((await decide_the_same_call(fixture)).kind).toBe('needs_approval');

    const response = await press(fixture, 'approval_always');

    expect(await response.json()).toMatchObject({
      text: '✓ Approved by <@U777> — not asking about calculate again from now on. Change this anytime in Settings → Tool permissions.',
    });
    expect(await read_decisions(fixture)).toEqual([
      { job_id: fixture.job_id, decision: 'approved' },
    ]);
    expect(await read_allow_policies(fixture)).toEqual([
      {
        resource_type: 'node',
        resource_id: 'math-calculate-1',
        scope_type: 'workspace',
        scope_id: fixture.bootstrap.workspace_id,
      },
    ]);
    expect(await decide_the_same_call(fixture)).toEqual({ kind: 'run' });
  });

  it('remembers a connected call against the account that asked, not the whole workspace', async () => {
    const fixture = await create_fixture({ connection_id: 'conn_slack_click' });
    answer_the_email_lookup(fixture.email);
    await ask_before_every_tool(fixture, 'conn_slack_click');

    await press(fixture, 'approval_always');

    expect(await read_allow_policies(fixture)).toEqual([
      {
        resource_type: 'node',
        resource_id: 'math-calculate-1',
        scope_type: 'connection',
        scope_id: 'conn_slack_click',
      },
    ]);
  });

  it('answers the workspace that asked, even when the call went through an account', async () => {
    const fixture = await create_fixture({ connection_id: 'conn_slack_click' });
    answer_the_email_lookup(fixture.email);
    await ask_before_every_tool(fixture);
    expect((await decide_the_same_call(fixture)).kind).toBe('needs_approval');

    await press(fixture, 'approval_always');

    expect(await read_allow_policies(fixture)).toEqual([
      {
        resource_type: 'node',
        resource_id: 'math-calculate-1',
        scope_type: 'workspace',
        scope_id: fixture.bootstrap.workspace_id,
      },
    ]);
    expect(await decide_the_same_call(fixture)).toEqual({ kind: 'run' });
  });

  it('leaves every other interactivity payload the no-op it has always been', async () => {
    const fixture = await create_fixture();

    const response = await post(fixture, {
      type: 'view_submission',
      team: { id: 'T777' },
      user: { id: 'U777' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(slack_api.lookup_email).not.toHaveBeenCalled();
  });

  it('turns away a payload that is not signed by Slack', async () => {
    const fixture = await create_fixture();
    answer_the_email_lookup(fixture.email);
    const body = form_body(block_actions_payload(fixture.job_id, 'approval_approve'));
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await fixture.app.request('/v1/channels/slack/interactivity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=not-the-signature',
      },
      body,
    });

    expect(response.status).toBe(401);
    expect(await read_decisions(fixture)).toEqual([]);
  });
});

function answer_the_email_lookup(email: string | undefined) {
  slack_api.lookup_email.mockResolvedValue(email ?? null);
}

function block_actions_payload(job_id: string, action_id: string) {
  return {
    type: 'block_actions',
    team: { id: 'T777' },
    user: { id: 'U777' },
    actions: [{ action_id, value: job_id }],
  };
}

function press(fixture: Fixture, action_id: string) {
  return post(fixture, block_actions_payload(fixture.job_id, action_id));
}

function post(fixture: Fixture, payload: unknown) {
  const body = form_body(payload);
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

function form_body(payload: unknown) {
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}

async function read_decisions(fixture: Fixture) {
  const rows = await fixture.db.query.events.findMany({
    where: and(
      eq(events.workspace_id, fixture.bootstrap.workspace_id),
      eq(events.event_type, 'person.decided'),
    ),
  });
  return rows.map((row) => ({
    job_id: (row.event_body as { job_id: string }).job_id,
    decision: (row.event_body as { decision: string }).decision,
  }));
}

async function read_allow_policies(fixture: Fixture) {
  const rows = await fixture.db.query.policies.findMany({
    where: and(
      eq(policies.workspace_id, fixture.bootstrap.workspace_id),
      eq(policies.policy_mode, 'allow'),
    ),
  });
  return rows.map((row) => ({
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
  }));
}

function ask_before_every_tool(fixture: Fixture, connection_id?: string) {
  return set_policy(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    resource_type: 'node_label',
    resource_id: 'every_tool',
    scope_type: connection_id ? 'connection' : 'workspace',
    scope_id: connection_id ?? fixture.bootstrap.workspace_id,
    policy_mode: 'ask',
    actor_id: fixture.bootstrap.user_id,
  });
}

function decide_the_same_call(fixture: Fixture) {
  return create_tool_batch_policy(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: fixture.session_id,
    run_id: fixture.run_id,
    agent_id: fixture.bootstrap.agent_id,
    actor_id: fixture.bootstrap.user_id,
  }).decide([
    { tool_call_id: 'call_1', tool_name: 'math-calculate-1', input: { expression: '2+2' } },
  ]);
}

async function read_wait_status(fixture: Fixture) {
  const row = await fixture.db.query.event_jobs.findFirst({
    where: eq(event_jobs.job_id, fixture.job_id),
  });
  return row?.job_status;
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

async function create_fixture({ connection_id }: { connection_id?: string } = {}) {
  vi.stubEnv('SLACK_SIGNING_SECRET', signing_secret);
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'approval-click-test-key';
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  const tool_call = await create_tool_call_started(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    tool_name: 'math-calculate-1',
    tool_input: { expression: '2+2' },
    tool_status: 'awaiting_approval',
    tool_call_metadata: connection_id ? { connection_id } : {},
    actor_id: bootstrap.user_id,
  });
  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq: is }) => is(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app seed missing');
  await db.insert(connections).values({
    connection_id: 'conn_slack_click',
    workspace_id: bootstrap.workspace_id,
    app_id: slack_app.app_id,
    connection_name: 'Slack click test',
    connection_status: 'active',
    connection_key: 'native:slack:click',
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
  const created = await create_tool_policy_wait(db, {
    workspace_id: bootstrap.workspace_id,
    queue_key: 'wait:tool_policy:click_test',
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: session.session_id,
      source_run_id: run.run_id,
      calls: [{ tool_call_id: tool_call.tool_call_id, input_sha256: 'a'.repeat(64) }],
      requested_by: bootstrap.user_id,
      eligible_user_ids: [bootstrap.user_id],
    },
    actor_id: bootstrap.user_id,
  });
  const user = await db.query.users.findFirst({
    where: (table, { eq: is }) => is(table.user_id, bootstrap.user_id),
  });

  return {
    db,
    app: create_app(db),
    bootstrap,
    session_id: session.session_id,
    run_id: run.run_id,
    job_id: created.event_job.job_id,
    email: user?.email,
  };
}
