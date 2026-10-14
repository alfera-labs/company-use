import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_run_message, create_session } from '@coworker/core/db/queries/sessions';
import { connections, run_messages } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({
  lookup_slack_user_id_by_email: vi.fn(
    async (_token: string, _email: string) => 'U_carla' as string | null,
  ),
  open_slack_dm_channel: vi.fn(
    async (_token: string, _slack_user_id: string) => 'D_carla' as string | undefined,
  ),
  post_slack_message: vi.fn(
    async (_token: string, _channel: string, _text: string, _options?: unknown) =>
      '1726400000.0001' as string | undefined,
  ),
}));
vi.mock('@runtime-platform/tools/slack/channels_api', () => ({
  ...slack,
  read_slack_bot_token: (connection: unknown) => (connection ? 'xoxb-test' : null),
}));

const { build_notification_message, deliver_to_person } = await import(
  '@runtime-platform/delivery/deliver_to_person'
);
const { notification_next_step } = await import(
  '@runtime-platform/notifications/notification_body'
);

type Db = Awaited<ReturnType<typeof create_test_database>>;
let db: Db;
let workspace_id: string;
let agent_id: string;
let user_id: string;

const message = {
  title: 'Ada moved the event to 14 June',
  body: 'The quote needs redoing before Friday.',
  because: 'she said so in the thread (evt_1)',
  next_step: 'Open the draft in Alfera and send it when it reads right.',
};

beforeEach(async () => {
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  agent_id = bootstrap.agent_id;
  user_id = bootstrap.user_id;
  vi.clearAllMocks();
  slack.lookup_slack_user_id_by_email.mockResolvedValue('U_carla');
  slack.open_slack_dm_channel.mockResolvedValue('D_carla');
  slack.post_slack_message.mockResolvedValue('1726400000.0001');
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

describe('deliver_to_person', () => {
  it('takes the first channel that works and never tries the rest', async () => {
    await connect_slack();
    const outcome = await deliver_to_person(db, {
      workspace_id,
      session_id: 'ses_1',
      principal_id: null,
      delivery_channel_order: ['slack_dm', 'email', 'web'],
      message,
    });

    expect(outcome).toEqual({
      delivered_on: 'slack_dm',
      delivery_ref: 'D_carla:1726400000.0001',
      delivery_error: null,
    });
    expect(slack.post_slack_message).toHaveBeenCalledTimes(1);
    expect(slack.post_slack_message.mock.calls[0]?.[2]).toContain(
      'Because: she said so in the thread',
    );
  });

  it('asks it as a card with Yes, No and Open in Alfera when the notification asks something', async () => {
    await connect_slack();

    const outcome = await deliver_to_person(db, {
      workspace_id,
      session_id: 'ses_1',
      principal_id: null,
      delivery_channel_order: ['slack_dm', 'web'],
      message,
      question: { notification_event_id: 'evt_notification_1', session_id: 'ses_1' },
    });

    expect(outcome.delivered_on).toBe('slack_dm');
    const [, , text, options] = slack.post_slack_message.mock.calls[0] ?? [];
    expect(text).toContain('Ada moved the event to 14 June');
    const blocks = (options as { blocks?: unknown[] } | undefined)?.blocks ?? [];
    expect(blocks[0]).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Ada moved the event to 14 June*\nThe quote needs redoing before Friday.',
      },
    });
    expect(blocks[1]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Because: she said so in the thread (evt_1)' }],
    });
    const buttons = (
      blocks[2] as { elements: { action_id?: string; value?: string; url?: string }[] }
    ).elements;
    expect(buttons.map((button) => button.action_id)).toEqual([
      'notification_yes',
      'notification_no',
      undefined,
    ]);
    expect(buttons[0]?.value).toBe('evt_notification_1');
    expect(buttons[1]?.value).toBe('evt_notification_1');
    expect(new URL(buttons[2]?.url ?? '').pathname).toBe('/chats/ses_1');
  });

  it('says a notification that asks nothing as the plain sentence it was', async () => {
    await connect_slack();

    await deliver_to_person(db, {
      workspace_id,
      session_id: 'ses_1',
      principal_id: null,
      delivery_channel_order: ['slack_dm', 'web'],
      message,
    });

    expect(slack.post_slack_message.mock.calls[0]?.[3]).toEqual({});
  });

  it('moves down the order when a channel cannot reach them, and says why', async () => {
    const outcome = await deliver_to_person(db, {
      workspace_id,
      session_id: 'ses_1',
      principal_id: null,
      delivery_channel_order: ['slack_dm', 'web'],
      message,
    });

    expect(outcome.delivered_on).toBe('web');
    expect(outcome.delivery_ref).toBe('feed');
    expect(outcome.delivery_error).toContain('slack_dm: no way to reach them');
    expect(slack.post_slack_message).not.toHaveBeenCalled();
  });

  it('reports every channel that failed when none of them can reach anybody', async () => {
    await connect_slack();
    slack.lookup_slack_user_id_by_email.mockResolvedValue(null);

    const outcome = await deliver_to_person(db, {
      workspace_id,
      session_id: 'ses_1',
      principal_id: null,
      delivery_channel_order: ['slack_dm', 'email'],
      message,
    });

    expect(outcome.delivered_on).toBeNull();
    expect(outcome.delivery_error).toContain('slack_dm: no way to reach them');
    expect(outcome.delivery_error).toContain('email: This workspace has no email address yet');
  });
});

describe('the live chat channel', () => {
  it('says it in the open chat when somebody typed there in the last day', async () => {
    await connect_slack();
    const session_id = await type_in_the_web_chat(hours_ago(2));

    const outcome = await deliver_to_person(db, {
      workspace_id,
      session_id: 'ses_notification',
      principal_id: user_id,
      delivery_channel_order: ['slack_dm', 'email', 'web'],
      message,
    });

    expect(outcome.delivered_on).toBe('chat');
    expect(outcome.delivery_ref).toContain(session_id);
    expect(slack.post_slack_message).not.toHaveBeenCalled();
    const said = await db.query.run_messages.findMany({
      where: (table, { and: both, eq: is }) =>
        both(is(table.session_id, session_id), is(table.message_role, 'assistant')),
    });
    expect(said).toHaveLength(1);
    expect(said[0]?.content_text).toContain('Ada moved the event to 14 June');
    expect(said[0]?.is_user_visible).toBe(true);
  });

  it('never picks a chat when the notification is for nobody in particular', async () => {
    await connect_slack();
    await type_in_the_web_chat(hours_ago(2));

    const outcome = await deliver_to_person(db, {
      workspace_id,
      session_id: 'ses_notification',
      principal_id: null,
      delivery_channel_order: ['slack_dm', 'web'],
      message,
    });

    expect(outcome.delivered_on).toBe('slack_dm');
  });

  it('falls through to Slack when the last thing typed in the chat is two days old', async () => {
    await connect_slack();
    await type_in_the_web_chat(hours_ago(48));

    const outcome = await deliver_to_person(db, {
      workspace_id,
      session_id: 'ses_notification',
      principal_id: null,
      delivery_channel_order: ['slack_dm', 'email', 'web'],
      message,
    });

    expect(outcome.delivered_on).toBe('slack_dm');
    expect(slack.post_slack_message).toHaveBeenCalledTimes(1);
  });
});

describe('build_notification_message', () => {
  it('says it in the order a person reads it, as plain text', () => {
    expect(build_notification_message(message)).toBe(
      [
        'Ada moved the event to 14 June',
        '',
        'The quote needs redoing before Friday.',
        '',
        'Because: she said so in the thread (evt_1)',
        'Next: Open the draft in Alfera and send it when it reads right.',
      ].join('\n'),
    );
  });
});

describe('the offer line a message ends with', () => {
  it('ends an offer to act with the yes, and names what it needs', () => {
    const text = build_notification_message({
      ...message,
      next_step: notification_next_step({
        kind: 'offer_to_act',
        instruction: 'check you in for AZ1234 on Friday',
        needs_apps: ['gmail'],
      }),
    });

    expect(
      text.endsWith(
        'Next: Say yes and I will check you in for AZ1234 on Friday. (I need gmail for this.)',
      ),
    ).toBe(true);
  });

  it('ends an app it wants with the connect, in one sentence', () => {
    const text = build_notification_message({
      ...message,
      next_step: notification_next_step({
        kind: 'connect_app',
        app_name: 'Stripe',
        reason: "chase Acme's failed 900 EUR payment",
      }),
    });

    expect(
      text.endsWith("Next: Connect Stripe and I will chase Acme's failed 900 EUR payment."),
    ).toBe(true);
  });
});

function hours_ago(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1_000);
}

async function type_in_the_web_chat(typed_time: Date) {
  const session = await create_session(db, { workspace_id, agent_id, actor_id: user_id });
  const run = await create_run(db, {
    workspace_id,
    session_id: session.session_id,
    agent_id,
    trigger_type: 'user_message',
    actor_id: user_id,
  });
  const typed = await create_run_message(db, {
    workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    message_role: 'user',
    message_content: { type: 'text', text: 'what is left for the Harbor wedding?' },
    source_type: 'dashboard',
    actor_id: user_id,
  });
  await db
    .update(run_messages)
    .set({ created_time: typed_time })
    .where(eq(run_messages.run_message_id, typed.run_message_id));
  return session.session_id;
}
