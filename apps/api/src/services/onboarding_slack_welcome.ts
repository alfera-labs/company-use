import { product_brand_config } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  claim_onboarding_welcome,
  get_onboarding_record,
} from '@coworker/core/db/queries/onboarding';
import { get_user } from '@coworker/core/db/queries/users';
import {
  type DiscoveryNotificationChannel,
  find_active_slack_connection_for_workspace,
  find_primary_member_channel,
  lookup_slack_user_id_by_email,
  open_slack_dm_channel,
  post_slack_message,
  read_slack_authed_user_id,
  read_slack_bot_token,
  reading_the_channels_line,
  start_workspace_discovery_run,
} from '@coworker/runtime-platform';
import { create_logger, format_error_message } from '@coworker/shared';

const onboarding_log = create_logger('onboarding');

type WelcomeTarget = { workspace_id: string; user_id: string };

/** Says hello in Slack once per workspace and starts the first read of the channels. */
export async function send_slack_welcome(db: Database, target: WelcomeTarget) {
  const { workspace_id, user_id } = target;
  const record = await get_onboarding_record(db, { workspace_id, user_id });
  if (record.welcome_sent) return { sent: false, already_sent: true };

  const connection = await find_active_slack_connection_for_workspace(db, workspace_id);
  const token = connection ? read_slack_bot_token(connection) : null;
  if (!connection || !token) return { sent: false, reason: 'slack_not_connected' };

  const claimed = await claim_onboarding_welcome(db, { workspace_id, actor_id: user_id });
  if (!claimed) return { sent: false, already_sent: true };

  return greet_new_slack_workspace(db, target, { connection, token });
}

type ActiveSlackConnection = NonNullable<
  Awaited<ReturnType<typeof find_active_slack_connection_for_workspace>>
>;

async function greet_new_slack_workspace(
  db: Database,
  target: WelcomeTarget,
  slack: { connection: ActiveSlackConnection; token: string },
) {
  const { token } = slack;
  const user = await get_user(db, target.user_id);
  const first_name = user?.first_name?.trim() || null;
  const slack_user_id = await find_installer_slack_user_id(slack, user?.email ?? null);

  const [opened_dm_channel_id, primary] = await Promise.all([
    try_one_slack_step(
      () => (slack_user_id ? open_slack_dm_channel(token, slack_user_id) : null),
      target,
    ),
    try_one_slack_step(() => find_primary_member_channel(token), target),
  ]);
  const dm_channel_id = opened_dm_channel_id ?? null;

  const is_reading_the_channels = await start_first_look(db, target, { primary, dm_channel_id });
  const post = (channel_id: string | null, text: string) =>
    channel_id
      ? try_one_slack_step(() => post_slack_message(token, channel_id, text), target)
      : null;
  const channel_posted = await post(
    primary?.id ?? null,
    welcome_channel_text({ first_name, is_reading_the_channels }),
  );
  const channel_name = channel_posted ? (primary?.name ?? null) : null;
  const dm_posted = await post(
    dm_channel_id,
    welcome_dm_text({ first_name, channel_name, is_reading_the_channels }),
  );

  return {
    sent: Boolean(dm_posted) || Boolean(channel_posted),
    dm_sent: Boolean(dm_posted),
    channel: channel_name,
    discovery_started: is_reading_the_channels,
  };
}

async function find_installer_slack_user_id(
  slack: { connection: ActiveSlackConnection; token: string },
  email: string | null,
) {
  return (
    read_slack_authed_user_id(slack.connection) ??
    (email ? await lookup_slack_user_id_by_email(slack.token, email) : null)
  );
}

async function start_first_look(
  db: Database,
  target: WelcomeTarget,
  where: { primary: { id: string; name: string } | null; dm_channel_id: string | null },
) {
  const notification_channel = first_look_channel(where);
  const discovery = await try_one_slack_step(
    () =>
      start_workspace_discovery_run(db, {
        workspace_id: target.workspace_id,
        actor_id: target.user_id,
        announce_start: false,
        ...(notification_channel ? { notification_channel } : {}),
      }),
    target,
  );
  return discovery?.started === true;
}

function first_look_channel(where: {
  primary: { id: string; name: string } | null;
  dm_channel_id: string | null;
}): DiscoveryNotificationChannel | undefined {
  if (where.primary) {
    return {
      channel_id: where.primary.id,
      channel_name: where.primary.name,
      source: 'onboarding_primary_channel',
    };
  }
  if (where.dm_channel_id) {
    return { channel_id: where.dm_channel_id, channel_name: null, source: 'onboarding_dm' };
  }
  return undefined;
}

async function try_one_slack_step<Result>(
  step: () => Promise<Result> | Result,
  target: WelcomeTarget,
): Promise<Result | null> {
  try {
    return await step();
  } catch (error) {
    onboarding_log.warn('a Slack welcome step failed', {
      workspace_id: target.workspace_id,
      error: format_error_message(error),
    });
    return null;
  }
}

export function welcome_channel_text(input: {
  first_name: string | null;
  is_reading_the_channels: boolean;
}) {
  const coworker_name = product_brand_config.product_brand_name;
  const hello = input.first_name
    ? `Hey everyone 👋 I'm ${coworker_name}, ${input.first_name} just brought me in.`
    : `Hey everyone 👋 I'm ${coworker_name}, I just joined.`;
  if (input.is_reading_the_channels) return [hello, reading_the_channels_line].join('\n\n');
  return `${hello} I'm here for the stuff nobody wants on their plate. Just @ me. I'm new, so tell me when I get something wrong.`;
}

export function welcome_dm_text(input: {
  first_name: string | null;
  channel_name: string | null;
  is_reading_the_channels: boolean;
}) {
  const thanks = input.first_name
    ? `Hey ${input.first_name} 👋 thanks for bringing me in.`
    : 'Hey 👋 thanks for bringing me in.';
  if (!input.is_reading_the_channels) {
    return `${thanks} Message me here or @ me in a channel, and throw anything at me.`;
  }
  if (!input.channel_name) return `${thanks} ${reading_the_channels_line}`;
  return `${thanks} I just said hi in #${input.channel_name} and I'm reading through the channels now. I'll post what I find there.`;
}
