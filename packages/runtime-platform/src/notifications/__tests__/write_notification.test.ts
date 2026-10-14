import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_notifications_page } from '@coworker/core/db/queries/notification_outcomes';
import { create_run, create_run_message, create_session } from '@coworker/core/db/queries/sessions';
import { automations, connections, users, workspace_members } from '@coworker/core/db/schema';
import { AppError } from '@coworker/shared';
import type { WorkspaceVolumeAddress } from '@runtime-platform/files/workspace_volume_browser';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({
  lookup_slack_user_id_by_email: vi.fn(async (_token: string, email: string) => `U_${email}`),
  open_slack_dm_channel: vi.fn(
    async (_token: string, slack_user_id: string) => `D_${slack_user_id}`,
  ),
  post_slack_message: vi.fn(async () => '1726400000.0001' as string | undefined),
}));
vi.mock('@runtime-platform/tools/slack/channels_api', () => ({
  ...slack,
  read_slack_bot_token: (connection: unknown) => (connection ? 'xoxb-test' : null),
}));

const { write_notification } = await import('@runtime-platform/notifications/write_notification');

const address: WorkspaceVolumeAddress = {
  volume_id: 'vol_test',
  provider_volume_id: 'pv_test',
  region: undefined,
  volume_workspace_path: 'agents/agt_test',
  layout: current_workspace_layout,
};

type PolicyReaders = NonNullable<Parameters<typeof write_notification>[1]['policy_readers']>;

function policy_readers(frontmatter: string[]): PolicyReaders {
  return {
    resolve_address: async () => address,
    read_file: async () => new TextEncoder().encode(['---', ...frontmatter, '---', ''].join('\n')),
  };
}

const no_policy_file: PolicyReaders = {
  resolve_address: async () => address,
  read_file: async () => {
    throw new AppError('workspace_file_not_found', 'That file no longer exists.', 404);
  },
};

type Db = Awaited<ReturnType<typeof create_test_database>>;
let db: Db;
let workspace_id: string;
let agent_id: string;
let user_id: string;

beforeEach(async () => {
  vi.clearAllMocks();
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  agent_id = bootstrap.agent_id;
  user_id = bootstrap.user_id;
});

function notification(overrides: Record<string, unknown> = {}) {
  return {
    automation_id: 'atm_billing',
    run_id: 'run_1',
    session_id: 'ses_1',
    subject: 'thread_17bb03',
    claim: 'asked for a refund',
    title: 'Sam asked about invoice 1042',
    body: 'Sam changed the plan and the invoice needs redoing.',
    urgency: 'routine' as const,
    evidence: { event_ids: ['evt_1'] },
    score: 90,
    reason: 'a customer changed a paid plan',
    ...overrides,
  };
}

function write(overrides: Record<string, unknown> = {}, readers: PolicyReaders = no_policy_file) {
  return write_notification(db, {
    workspace_id,
    agent_id,
    actor_id: user_id,
    written_by: 'run',
    notification: notification(overrides),
    now: new Date('2026-09-15T12:00:00Z'),
    policy_readers: readers,
  });
}

describe('write_notification', () => {
  it('writes one notification, interrupts on a high score, and records where it landed', async () => {
    const result = await write();

    expect(result.outcome).toBe('notify_now');
    expect(result.notification_event_id).toMatch(/^/u);
    const rows = await read_notifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('notify_now');
    expect(rows[0]?.is_open).toBe(true);
    expect(rows[0]?.notification.policy_hash).toBe('default');
    expect(rows[0]?.notification.evidence).toEqual({
      event_ids: ['evt_1'],
      brain_slugs: [],
      run_ids: [],
      message_refs: [],
    });
    expect(rows[0]?.notification.delivered_on).toBeNull();
    expect(rows[0]?.notification.delivery_error).toContain('slack_dm: no way to reach them');
    expect(result.delivered_on).toBeNull();
  });

  it('tells the automation owner, never another member’s chat or DM', async () => {
    await connect_slack();
    const other_member = await add_member('other@example.com');
    await type_in_the_web_chat(other_member);
    await seed_automation('atm_owned', user_id);

    const result = await write_notification(db, {
      workspace_id,
      agent_id,
      actor_id: 'system:automation',
      written_by: 'run',
      notification: notification({ automation_id: 'atm_owned' }),
      now: new Date('2026-09-15T12:00:00Z'),
      policy_readers: no_policy_file,
    });

    expect(result.delivered_on).toBe('slack_dm');
    const owner = await db.query.users.findFirst({
      where: (table, { eq: is }) => is(table.user_id, user_id),
    });
    expect(slack.lookup_slack_user_id_by_email.mock.calls.map((call) => call[1])).toEqual([
      owner?.email,
    ]);
    const said_in_other_chat = await db.query.run_messages.findMany({
      where: (table, { eq: is }) => is(table.message_role, 'assistant'),
    });
    expect(said_in_other_chat).toHaveLength(0);
    const [row] = await read_notifications();
    expect(row?.notification.principal_id).toBe(user_id);
  });

  it('records every channel that could not reach them when none of them can', async () => {
    const no_feed = policy_readers(['dial: normal', 'delivery_channel_order: [slack_dm, email]']);
    const result = await write({}, no_feed);

    expect(result.outcome).toBe('notify_now');
    expect(result.delivered_on).toBeNull();
    expect(result.delivery_error).toContain('slack_dm');
    expect(result.delivery_error).toContain('email');
    const [row] = await read_notifications();
    expect(row?.notification.delivery_error).toBe(result.delivery_error);
  });

  it('refuses the same notification twice, whichever automation noticed it', async () => {
    const first = await write();
    const second = await write({
      automation_id: 'atm_scout',
      run_id: 'run_2',
      title: 'Sam asked again',
      score: 95,
    });

    expect(first.outcome).toBe('notify_now');
    expect(second).toMatchObject({
      notification_event_id: null,
      outcome: 'drop_with_reason',
      outcome_reason: 'this fingerprint has already been notified',
      notification_fingerprint: first.notification_fingerprint,
    });
    const rows = await read_notifications();
    expect(rows).toHaveLength(1);
  });

  it('counts the day’s interruptions from the ledger and summarizes the rest', async () => {
    await connect_slack();
    const one_a_day = policy_readers(['dial: normal', 'max_notifications_per_day: 1']);
    const first = await write({ subject: 'thread_a' }, one_a_day);
    const second = await write({ subject: 'thread_b' }, one_a_day);

    expect(first.outcome).toBe('notify_now');
    expect(second.outcome).toBe('add_to_daily_summary');
    expect(second.outcome_reason).toContain('spent');
  });

  it('keeps the cap when several runs write into the same free slot at once', async () => {
    const one_a_day = policy_readers(['dial: normal', 'max_notifications_per_day: 1']);
    const results = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((letter) => write({ subject: `thread_${letter}` }, one_a_day)),
    );

    const rows = await read_notifications();
    expect(rows.filter((row) => row.outcome === 'notify_now')).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'notify_now')).toHaveLength(1);
    expect(rows.filter((row) => row.outcome === 'add_to_daily_summary')).toHaveLength(4);
    const reasons = new Set(
      results.filter((result) => result.outcome !== 'notify_now').map((r) => r.outcome_reason),
    );
    expect([...reasons]).toEqual(["today's 1 interruptions are spent"]);
  });

  it('never interrupts when the file says attention is off', async () => {
    const off = policy_readers(['mode: off']);
    const result = await write({}, off);
    expect(result.outcome).toBe('add_to_ideas_list');
    expect(result.delivered_on).toBeNull();
    expect(result.policy_hash).toHaveLength(64);
  });

  it('says a different thing about the same subject as its own notification', async () => {
    const asked = await write();
    const moved = await write({ claim: 'changed the plan', title: 'Sam changed the plan' });
    expect(moved.notification_fingerprint).not.toBe(asked.notification_fingerprint);
    expect(moved.notification_event_id).not.toBeNull();
  });

  it('reports an notification-rules.md it cannot read instead of quietly using the defaults', async () => {
    const broken = policy_readers(['dial: screaming']);
    const result = await write({}, broken);

    expect(result.outcome).toBe('notify_now');
    const rows = await read_notifications();
    const report = rows.find((row) => row.notification.urgency === 'system_problem');
    expect(report?.notification.title).toContain('did not parse');
    expect(report?.outcome).toBe('notify_now');

    await write({ subject: 'thread_b' }, broken);
    const after = await read_notifications();
    expect(after.filter((row) => row.notification.urgency === 'system_problem')).toHaveLength(1);
  });

  it('never interrupts while notification-rules.md cannot be read', async () => {
    const unreachable: PolicyReaders = {
      resolve_address: async () => address,
      read_file: async () => {
        throw new Error('the volume is not reachable');
      },
    };
    const result = await write({}, unreachable);

    expect(result.outcome).toBe('add_to_daily_summary');
    const rows = await read_notifications();
    expect(rows.filter((row) => row.outcome === 'notify_now')).toHaveLength(0);
    const report = rows.find((row) => row.notification.title.includes('could not be read'));
    expect(report?.notification.urgency).toBe('fyi');
  });

  it('writes a run’s system_problem claim down as a deadline', async () => {
    const result = await write({ urgency: 'system_problem', score: 5 });

    const [row] = await read_notifications();
    expect(row?.notification.urgency).toBe('deadline');
    expect(row?.notification.metadata).toMatchObject({ urgency_coerced_from: 'system_problem' });
    expect(result.outcome).toBe('drop_with_reason');
    expect(result.delivered_on).toBeNull();
  });

  it('lets the platform itself write system_problem', async () => {
    const result = await write_notification(db, {
      workspace_id,
      agent_id,
      actor_id: 'system:watchdog',
      written_by: 'platform',
      notification: notification({ urgency: 'system_problem', score: 5 }),
      now: new Date('2026-09-15T12:00:00Z'),
      policy_readers: no_policy_file,
    });

    expect(result.outcome).toBe('notify_now');
    const [row] = await read_notifications();
    expect(row?.notification.urgency).toBe('system_problem');
  });

  it('refuses a notification that stands on nothing', async () => {
    await expect(write({ evidence: {} })).rejects.toThrow(/at least one piece of evidence/u);
  });
});

async function connect_slack() {
  await seed_runtime_tool_catalog(db);
  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq: is }) => is(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app seed missing');
  await db.insert(connections).values({
    connection_id: 'con_slack',
    workspace_id,
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

async function add_member(email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, created_by: 'system:test', last_updated_by: 'system:test' })
    .returning();
  if (!user) throw new Error('user seed failed');
  await db.insert(workspace_members).values({
    workspace_member_id: `wsm_${user.user_id}`,
    workspace_id,
    user_id: user.user_id,
    created_by: 'system:test',
    last_updated_by: 'system:test',
  });
  return user.user_id;
}

async function type_in_the_web_chat(member_id: string) {
  const session = await create_session(db, { workspace_id, agent_id, actor_id: member_id });
  const run = await create_run(db, {
    workspace_id,
    session_id: session.session_id,
    agent_id,
    trigger_type: 'user_message',
    actor_id: member_id,
  });
  await create_run_message(db, {
    workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    message_role: 'user',
    message_content: { type: 'text', text: 'my private notes' },
    source_type: 'dashboard',
    actor_id: member_id,
  });
}

async function seed_automation(automation_id: string, owner_id: string) {
  await db.insert(automations).values({
    automation_id,
    workspace_id,
    agent_id,
    automation_name: 'Billing questions',
    instruction: 'Draft a reply.',
    created_by: owner_id,
    last_updated_by: owner_id,
  });
}

async function read_notifications() {
  const page = await list_notifications_page(db, { workspace_id, page: 1, page_size: 100 });
  return page.items;
}
