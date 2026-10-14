import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_tool_policy_wait } from '@coworker/core/db/queries/event_waits';
import {
  create_run,
  create_session,
  create_tool_call_started,
} from '@coworker/core/db/queries/sessions';
import { connections, sessions } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { send_slack_approval_cards } from '@runtime-platform/tools/policies/approval_slack_cards';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({
  lookup_by_email: vi.fn(),
  conversations_open: vi.fn(),
  chat_post_message: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = { lookupByEmail: slack_sdk.lookup_by_email };
    conversations = { open: slack_sdk.conversations_open };
    chat = { postMessage: slack_sdk.chat_post_message };
  },
}));

const team_id = 'T777';
const thread_channel_id = 'C900';
const thread_ts = '1710000000.000200';

describe('sending an approval card', () => {
  afterEach(() => {
    slack_sdk.lookup_by_email.mockReset();
    slack_sdk.conversations_open.mockReset();
    slack_sdk.chat_post_message.mockReset();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('replies in the thread the run is already talking in', async () => {
    const fixture = await create_fixture({ in_a_thread: true });
    slack_sdk.chat_post_message.mockResolvedValue({ ok: true, ts: '1710000000.000300' });

    const delivered = await send_slack_approval_cards(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      wait: fixture.wait,
    });

    expect(delivered).toBe(1);
    const [posted] = read_posted_card();
    expect(posted.channel).toBe(thread_channel_id);
    expect(posted.thread_ts).toBe(thread_ts);
    expect(slack_sdk.conversations_open).not.toHaveBeenCalled();

    expect(posted.text).toContain('I need your OK to');
    const [sentence] = posted.blocks;
    expect(String((sentence?.text as { text: string }).text)).toContain('I need your OK to');
    expect(read_footer(posted)).toBe(
      'You can change what needs approval anytime in Settings → Tool permissions.',
    );
  });

  it('direct messages each decider when the run has no thread to reply in', async () => {
    const fixture = await create_fixture();
    slack_sdk.lookup_by_email.mockResolvedValue({ ok: true, user: { id: 'U777' } });
    slack_sdk.conversations_open.mockResolvedValue({ ok: true, channel: { id: 'D777' } });
    slack_sdk.chat_post_message.mockResolvedValue({ ok: true, ts: '1710000000.000100' });

    const delivered = await send_slack_approval_cards(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      wait: fixture.wait,
    });

    expect(delivered).toBe(1);
    expect(slack_sdk.lookup_by_email).toHaveBeenCalledWith({ email: fixture.email });
    const [posted] = read_posted_card();
    expect(posted.channel).toBe('D777');
    expect(posted.thread_ts).toBeUndefined();
    expect(posted.text).toContain('I need your OK to');

    const [sentence, fields, actions] = posted.blocks;
    expect(sentence).toMatchObject({ type: 'section' });
    expect(String((fields?.text as { text: string }).text)).toContain('4471');
    expect(actions).toMatchObject({
      type: 'actions',
      elements: [
        { action_id: 'approval_approve', style: 'primary', value: fixture.wait.job_id },
        { action_id: 'approval_refuse', style: 'danger', value: fixture.wait.job_id },
        { action_id: 'approval_allow_chat', text: { text: 'Allow for this chat' } },
        { action_id: 'approval_allow_30_days', text: { text: 'Allow for 30 days' } },
        { action_id: 'approval_always', text: { text: 'Always allow' } },
        { url: expect.stringContaining('/inbox') },
      ],
    });
    expect(
      read_buttons(posted).find((button) => button.action_id === 'approval_always')?.style,
    ).toBeUndefined();
  });

  it('shows every call of a wait written before calls said who they were for', async () => {
    const fixture = await create_fixture({ in_a_thread: true, a_second_call_with_no_flag: true });
    slack_sdk.chat_post_message.mockResolvedValue({ ok: true, ts: '1710000000.000500' });

    await send_slack_approval_cards(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      wait: fixture.wait,
    });

    const [posted] = read_posted_card();
    const [sentence] = posted.blocks;
    expect(String((sentence?.text as { text: string }).text)).toContain('And 1 more step');
  });

  it('says nothing and fails nothing when no decider has a chat account', async () => {
    const fixture = await create_fixture();
    slack_sdk.lookup_by_email.mockRejectedValue(new Error('users_not_found'));

    await expect(
      send_slack_approval_cards(fixture.db, {
        workspace_id: fixture.bootstrap.workspace_id,
        wait: fixture.wait,
      }),
    ).resolves.toBe(0);
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
  });

  it('sends nothing when the workspace has no chat install', async () => {
    const fixture = await create_fixture({ with_slack: false });

    await expect(
      send_slack_approval_cards(fixture.db, {
        workspace_id: fixture.bootstrap.workspace_id,
        wait: fixture.wait,
      }),
    ).resolves.toBe(0);
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
  });
});

type PostedCard = {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks: Array<Record<string, unknown>>;
};

function read_posted_card() {
  return slack_sdk.chat_post_message.mock.calls[0] as [PostedCard];
}

function read_buttons(posted: PostedCard) {
  const actions = posted.blocks.find((block) => block.type === 'actions');
  return (actions?.elements ?? []) as Array<{ action_id?: string; style?: string }>;
}

function read_footer(posted: PostedCard) {
  const context = posted.blocks.find((block) => block.type === 'context');
  const [element] = (context?.elements ?? []) as Array<{ text: string }>;
  return element?.text;
}

async function create_fixture({
  with_slack = true,
  in_a_thread = false,
  a_second_call_with_no_flag = false,
}: {
  with_slack?: boolean;
  in_a_thread?: boolean;
  a_second_call_with_no_flag?: boolean;
} = {}) {
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'approval-card-test-key';
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    ...(in_a_thread ? thread_session_values() : {}),
  });
  if (in_a_thread) await name_the_person_in_the_thread(db, session.session_id);
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
    tool_name: 'billing-refund_payment-1',
    tool_input: { order_id: '4471', amount: 240, currency: 'GBP' },
    tool_status: 'awaiting_approval',
    tool_call_metadata: {},
    actor_id: bootstrap.user_id,
  });
  const second_call = a_second_call_with_no_flag
    ? await create_tool_call_started(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: run.run_id,
        tool_name: 'math-calculate-1',
        tool_input: { expression: '2 + 2' },
        tool_status: 'awaiting_approval',
        actor_id: bootstrap.user_id,
      })
    : null;
  if (with_slack) await add_slack_install(db, bootstrap);
  const created = await create_tool_policy_wait(db, {
    workspace_id: bootstrap.workspace_id,
    queue_key: 'wait:tool_policy:card_test',
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: session.session_id,
      source_run_id: run.run_id,
      calls: [
        { tool_call_id: tool_call.tool_call_id, input_sha256: 'a'.repeat(64) },
        ...(second_call
          ? [{ tool_call_id: second_call.tool_call_id, input_sha256: 'b'.repeat(64) }]
          : []),
      ],
      requested_by: bootstrap.user_id,
      eligible_user_ids: [bootstrap.user_id],
    },
    actor_id: bootstrap.user_id,
  });
  const user = await db.query.users.findFirst({
    where: (table, { eq: is }) => is(table.user_id, bootstrap.user_id),
  });

  return { db, bootstrap, wait: created.event_job, email: user?.email };
}

function thread_session_values() {
  return {
    source_type: 'slack' as const,
    session_source: 'slack' as const,
    external_thread_key: `slack:${team_id}:${thread_channel_id}:thread:${thread_ts}`,
    source_metadata: {
      slack: {
        team_id,
        channel_id: thread_channel_id,
        channel_type: 'channel' as const,
        thread_ts,
      },
    },
  };
}

function name_the_person_in_the_thread(
  db: Awaited<ReturnType<typeof create_test_database>>,
  session_id: string,
) {
  return db
    .update(sessions)
    .set({
      session_metadata: {
        actors: [
          {
            source_actor_id: 'sact_thread_reader',
            actor_kind: 'external_user' as const,
            profile: { display_name: 'Thread reader' },
            first_seen_time: '2026-01-01T00:00:00.000Z',
            last_seen_time: '2026-01-01T00:00:00.000Z',
            message_count: 1,
            external_ids: [
              {
                provider_key: 'slack',
                external_account_id: team_id,
                external_user_id: 'U900',
              },
            ],
          },
        ],
      },
    })
    .where(eq(sessions.session_id, session_id));
}

async function add_slack_install(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
) {
  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq: is }) => is(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app seed missing');
  await db.insert(connections).values({
    connection_id: 'conn_slack_card',
    workspace_id: bootstrap.workspace_id,
    app_id: slack_app.app_id,
    connection_name: 'Slack card test',
    connection_status: 'active',
    connection_key: 'native:slack:card',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: team_id,
    external_account_name: 'Card test workspace',
    authorized_scopes: ['chat:write', 'users:read.email'],
    health_status: 'healthy',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'xoxb-card' },
    }),
    provider_account: { team_id, bot_user_id: 'B777' },
    metadata: {},
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
}
