import type { list_slack_channel_access_rows } from '@runtime-platform/channels/slack/channel_setup';
import type { SlackChannelSummary } from '@runtime-platform/tools/slack/channels_api';

type SlackAccessRow = Awaited<ReturnType<typeof list_slack_channel_access_rows>>[number];

export function apply_slack_channel_access(
  channels: SlackChannelSummary[],
  access_rows: SlackAccessRow[],
) {
  const row_by_channel_id = new Map(access_rows.map((row) => [row.external_conversation_id, row]));
  return channels.map((channel) => ({
    ...channel,
    is_enabled: read_slack_access_enabled(
      channel,
      row_by_channel_id.get(channel.id)?.channel_status,
    ),
    project_id: row_by_channel_id.get(channel.id)?.project_id ?? null,
    channel_route_id: row_by_channel_id.get(channel.id)?.channel_id ?? null,
  }));
}

function read_slack_access_enabled(channel: SlackChannelSummary, status: string | undefined) {
  if (status === 'enabled') return true;
  if (status === 'disabled' || status === 'error') return false;
  return channel.is_member;
}
