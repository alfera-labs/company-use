import type { Database } from '@coworker/core';
import { fire_automation_ears } from '@runtime-platform/automations/fire_automation_ears';
import {
  is_slack_thread_reply,
  type SlackChannelMessage,
} from '@runtime-platform/channels/slack/channel_routing';
import { native_trigger_node_keys } from '@runtime-platform/tools/native_trigger_seed';

export async function fire_slack_message_ears(
  db: Database,
  input: { workspace_id: string; message: SlackChannelMessage; received_time?: Date },
) {
  const message = input.message;
  return fire_automation_ears(db, {
    workspace_id: input.workspace_id,
    node_key: native_trigger_node_keys.slack_message,
    // The MESSAGE, not the delivery: Slack sends a mention twice (as `message` and as
    // `app_mention`, two event ids), and retries the same one on a slow ACK. All of those are one
    // thing that happened, so all of them dedup to one fire.
    occurrence_key: `slack:${message.team_id}:${message.channel_id}:${message.event_ts}`,
    ...(input.received_time ? { received_time: input.received_time } : {}),
    matches_setup: (setup) => watches_this_channel(setup, message.channel_id),
    data: {
      thread_id: read_slack_thread_id(message),
      channel_id: message.channel_id,
      channel_type: message.channel_type,
      user_id: message.user_id,
      text: message.text ?? message.raw_text ?? '',
      ts: message.event_ts,
      is_thread_reply: is_slack_thread_reply(message),
      is_mention: Boolean(message.mentioned_bot_user_id),
    },
  });
  // No channel_name, user_name or permalink. Each is a Slack web call per message on the
  // webhook's clock. Add them (batched, cached) when an automation needs to say a name out loud.
}

function read_slack_thread_id(message: SlackChannelMessage) {
  const thread_root = message.thread_ts?.trim() || message.event_ts;
  return `${message.channel_id}:${thread_root}`;
}

function watches_this_channel(setup: Record<string, unknown>, channel_id: string) {
  const wanted = setup.channel_id;
  if (typeof wanted !== 'string' || !wanted.trim()) return true;
  return wanted.trim() === channel_id;
}
