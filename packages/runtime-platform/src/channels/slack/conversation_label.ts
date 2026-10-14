import { create_logger, format_error_message } from '@coworker/shared';
import type { SlackChannelMessage } from '@runtime-platform/channels/slack/channel_routing';
import type { WebClient } from '@slack/web-api';

const log = create_logger('slack_conversation_label');

export async function resolve_slack_conversation_label(
  slack_api: WebClient,
  message: SlackChannelMessage,
): Promise<string> {
  if (message.channel_type === 'im') return direct_message_label(message);
  if (message.channel_type === 'mpim') return 'group DM';

  const channel_name = await read_slack_channel_name(slack_api, message.channel_id);
  return channel_name ? `#${channel_name}` : message.channel_id;
}

function direct_message_label(message: SlackChannelMessage) {
  const handle =
    message.user_profile?.display_name?.trim() ||
    message.user_profile?.username?.trim() ||
    message.user_profile?.real_name?.trim();
  return handle ? `@${handle}` : 'DM';
}

async function read_slack_channel_name(slack_api: WebClient, channel_id: string) {
  try {
    const response = await slack_api.conversations.info({ channel: channel_id });
    return response.channel?.name?.trim() || null;
  } catch (error) {
    log.debug('Slack channel name lookup failed', {
      channel_id,
      error: format_error_message(error),
    });
    return null;
  }
}
