import type { SlackChannelSettingsPage } from '@/lib/api';

export type SlackSettingsChannel = SlackChannelSettingsPage['channels'][number];

export function filter_channels(channels: SlackSettingsChannel[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return channels;
  return channels.filter((channel) => channel.name.toLowerCase().includes(query));
}

/**
 * The bot can join public channels itself, but a private channel needs a human to invite it
 * in Slack first — until then the checkbox stays locked.
 */
export function can_change_access(channel: SlackSettingsChannel) {
  if (channel.is_enabled) return true;
  return channel.is_member || !channel.is_private;
}

export function channel_members_label(channel: SlackSettingsChannel) {
  if (channel.num_members === null) return channel.is_member ? 'In Slack' : 'Not in Slack';
  return `${channel.num_members} member${channel.num_members === 1 ? '' : 's'}`;
}
