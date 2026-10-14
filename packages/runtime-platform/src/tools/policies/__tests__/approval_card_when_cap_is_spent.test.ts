import { vi } from 'vitest';

const slack_cards = vi.fn(async () => 1);
const email_card = vi.fn(async () => 1);
vi.mock('@runtime-platform/tools/policies/approval_slack_cards', () => ({
  send_slack_approval_cards: slack_cards,
}));
vi.mock('@runtime-platform/tools/policies/approval_email_card', () => ({
  send_email_approval_card: email_card,
}));
vi.mock('@runtime-platform/tools/slack/channels_api', () => ({
  lookup_slack_user_id_by_email: async (_token: string, email: string) => `U_${email}`,
  open_slack_dm_channel: async (_token: string, slack_user_id: string) => `D_${slack_user_id}`,
  post_slack_message: async () => '1726400000.0001',
  read_slack_bot_token: (connection: unknown) => (connection ? 'xoxb-test' : null),
}));

const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
const { AppError } = await import('@coworker/shared');
const { write_notification } = await import('@runtime-platform/notifications/write_notification');
const { send_approval_cards } = await import('@runtime-platform/tools/policies/approval_delivery');
const { current_workspace_layout } = await import('@runtime-platform/storage/workspace_layouts');
const { connections } = await import('@coworker/core/db/schema');
const { seed_runtime_tool_catalog } = await import('@runtime-platform/tools/catalog_seed');
const {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} = await import('@runtime-platform/tools/slack/app_profile');
const { beforeEach, describe, expect, it } = await import('vitest');

const address = {
  volume_id: 'vol_test',
  provider_volume_id: 'pv_test',
  region: undefined,
  volume_workspace_path: 'agents/agt_test',
  layout: current_workspace_layout,
};
const no_policy_file = {
  resolve_address: async () => address,
  read_file: async () => {
    throw new AppError('workspace_file_not_found', 'That file no longer exists.', 404);
  },
};
const noon = new Date('2026-09-15T12:00:00Z');

type Db = Awaited<ReturnType<typeof create_test_database>>;
let db: Db;
let workspace_id: string;
let agent_id: string;
let user_id: string;

beforeEach(async () => {
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  agent_id = bootstrap.agent_id;
  user_id = bootstrap.user_id;
  slack_cards.mockClear();
  email_card.mockClear();
  await connect_slack();
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

function write_a_notification(subject: string) {
  return write_notification(db, {
    workspace_id,
    agent_id,
    actor_id: user_id,
    written_by: 'run',
    notification: {
      automation_id: 'atm_billing',
      run_id: 'run_1',
      session_id: 'ses_1',
      subject,
      claim: 'asked for a refund',
      title: `Sam asked about ${subject}`,
      body: 'Sam changed the plan and the invoice needs redoing.',
      urgency: 'routine' as const,
      evidence: { event_ids: ['evt_1'] },
      score: 90,
      reason: 'a customer changed a paid plan',
    },
    now: noon,
    policy_readers: no_policy_file,
  });
}

function a_held_step() {
  return {
    job_id: 'ejob_held',
    workspace_id,
    metadata: { policy_approval: { version: 2, session_id: 'ses_1' } },
  } as unknown as Parameters<typeof send_approval_cards>[1]['wait'];
}

describe('an approval card when the day is used up', () => {
  it('still goes out on the first channel after the cap has swallowed the notifications', async () => {
    for (const subject of ['s1', 's2', 's3', 's4', 's5']) await write_a_notification(subject);
    const over_the_cap = await write_a_notification('s6');
    expect(over_the_cap.outcome).toBe('add_to_daily_summary');
    expect(over_the_cap.outcome_reason).toContain('spent');

    const delivered = await send_approval_cards(db, {
      workspace_id,
      wait: a_held_step(),
      policy_readers: no_policy_file,
    });

    expect(delivered).toBe(1);
    expect(slack_cards).toHaveBeenCalledTimes(1);
    expect(email_card).not.toHaveBeenCalled();
  });

  it('falls to the next channel when the first one reaches nobody', async () => {
    slack_cards.mockResolvedValueOnce(0);

    const delivered = await send_approval_cards(db, {
      workspace_id,
      wait: a_held_step(),
      policy_readers: no_policy_file,
    });

    expect(delivered).toBe(1);
    expect(email_card).toHaveBeenCalledTimes(1);
  });
});
