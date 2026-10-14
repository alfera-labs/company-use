import type { ChannelMemoryAudienceSetting } from '@coworker/memory/contracts/audience';

export type SlackChannelPolicyData = {
  allowed_channel_ids?: string[];
  denied_channel_ids?: string[];
  allowed_user_ids?: string[];
  require_bot_mention_in_channels?: boolean;
};

export type SlackThreadBackfillPolicyData = {
  thread_initial_limit?: number;
  channel_recent_limit?: number;
};

export type ChannelConfigData = Record<string, unknown> & {
  channel_policy?: SlackChannelPolicyData;
  context_backfill?: SlackThreadBackfillPolicyData;
  memory_audience_setting?: ChannelMemoryAudienceSetting;
};
