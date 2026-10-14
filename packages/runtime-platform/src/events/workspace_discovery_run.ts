import { product_brand_config } from '@coworker/config';
import type { Database } from '@coworker/core';
import { find_active_slack_connection_for_workspace } from '@runtime-platform/channels/slack/workspace_connection';
import { first_contact_discovery_run_key } from '@runtime-platform/events/slack_discovery_event_payload';
import {
  type SlackDiscoveryDeliveryMode,
  start_workspace_slack_discovery,
} from '@runtime-platform/events/slack_discovery_trigger';
import {
  find_primary_member_channel,
  post_slack_message,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';

export type DiscoveryNotificationChannel = {
  channel_id: string;
  channel_name?: string | null;
  source: string;
};

type WorkspaceDiscoveryRunInput = {
  workspace_id: string;
  actor_id: string;
  discovery_run_key?: string;
  delivery_mode?: SlackDiscoveryDeliveryMode;
  notification_channel?: DiscoveryNotificationChannel;
  announce_start?: boolean;
};

export async function start_workspace_discovery_run(
  db: Database,
  input: WorkspaceDiscoveryRunInput,
) {
  const connection = await find_active_slack_connection_for_workspace(db, input.workspace_id);
  const token = connection ? read_slack_bot_token(connection) : null;
  if (!connection || !token) return { started: false, reason: 'slack_not_connected' };

  const discovery_run_key = input.discovery_run_key ?? first_contact_discovery_run_key;
  const notification_channel = await choose_notification_channel(input, token);
  const delivery_mode: SlackDiscoveryDeliveryMode = notification_channel ? 'slack' : 'silent';

  const discovery = await start_workspace_slack_discovery(db, {
    workspace_id: input.workspace_id,
    connection_id: connection.connection_id,
    discovery_run_key,
    ...(notification_channel
      ? {
          notification: {
            connection_id: connection.connection_id,
            channel_id: notification_channel.id,
            channel_name: notification_channel.name ?? null,
          },
        }
      : {}),
  });

  if (discovery.created && notification_channel && input.announce_start !== false) {
    await post_slack_message(token, notification_channel.id, discovery_started_text());
  }

  return {
    started: discovery.created,
    ...(discovery.created ? {} : { reason: 'already_ran' }),
    discovery_run_key,
    delivery_mode,
    event_id: discovery.event.event_id,
    queued_job_count: discovery.event_jobs.length,
    notification_channel_id: notification_channel?.id ?? null,
    notification_channel_source: notification_channel?.source ?? null,
    channel: notification_channel?.name ?? null,
  };
}

async function choose_notification_channel(input: WorkspaceDiscoveryRunInput, token: string) {
  if ((input.delivery_mode ?? 'slack') !== 'slack') return null;
  return (
    read_provided_notification_channel(input.notification_channel) ??
    (await resolve_notification_channel(token))
  );
}

async function resolve_notification_channel(token: string) {
  const primary_channel = await find_primary_member_channel(token);
  return primary_channel
    ? {
        id: primary_channel.id,
        name: primary_channel.name ?? null,
        source: 'primary_member_channel',
      }
    : null;
}

function read_provided_notification_channel(channel: DiscoveryNotificationChannel | undefined) {
  if (!channel) return null;
  return {
    id: channel.channel_id,
    name: channel.channel_name ?? null,
    source: channel.source,
  };
}

export const reading_the_channels_line =
  "Give me a couple of minutes, I'm reading through the channels to see how things run here 👀";

function discovery_started_text() {
  return [
    `Hey everyone 👋 I'm ${product_brand_config.product_brand_name}.`,
    reading_the_channels_line,
  ].join('\n\n');
}
