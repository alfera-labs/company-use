import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import { create_logger, format_error_message } from '@coworker/shared';
import type { SlackEventConnection } from '@runtime-platform/channels/slack/channel_event_dispatch';
import type { SlackChannelUserProfile } from '@runtime-platform/channels/slack/channel_routing';
import { WebClient } from '@slack/web-api';

const log = create_logger('slack_channel_event_dispatch');

export type SlackChannelMemberProfile = SlackChannelUserProfile & {
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
};

export function read_slack_bot_token(connection: SlackEventConnection) {
  if (!connection.credentials) return null;
  return (
    read_connection_credential_value(connection.credentials, 'bot_token') ??
    read_connection_credential_value(connection.credentials, 'access_token')
  );
}

export async function read_slack_user_profile(
  connection: SlackEventConnection,
  user_id: string,
): Promise<{ user_profile?: SlackChannelMemberProfile }> {
  const token = read_slack_bot_token(connection);
  if (!token) return {};

  try {
    const response = await new WebClient(token, {
      rejectRateLimitedCalls: true,
      retryConfig: { retries: 0 },
      timeout: 1_500,
    }).users.info({ user: user_id });
    const user = response.user;
    const profile = user?.profile;
    if (!user) return {};

    return {
      user_profile: {
        display_name: profile?.display_name || null,
        real_name: profile?.real_name || null,
        username: user.name || null,
        email: profile?.email || null,
        email_is_verified: typeof profile?.email === 'string' && profile.email.length > 0,
        avatar_url: profile?.image_192 || null,
        timezone: user.tz || null,
        is_bot: user.is_bot === true,
        is_restricted: user.is_restricted === true,
        is_ultra_restricted: user.is_ultra_restricted === true,
        profile_source: 'provider_profile',
        profile_synced_time: new Date().toISOString(),
      },
    };
  } catch (error) {
    log.warn('slack users.info failed or timed out; continuing without profile', {
      error: format_error_message(error),
    });
    return {};
  }
}
