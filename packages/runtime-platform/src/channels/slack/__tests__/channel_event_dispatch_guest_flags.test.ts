import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import type { SlackEventConnection } from '@runtime-platform/channels/slack/channel_event_dispatch';
import { build_slack_channel_message } from '@runtime-platform/channels/slack/channel_event_dispatch';
import type { SlackMessageEvent } from '@runtime-platform/channels/slack/slack_event_payload';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({
  users_info: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = { info: slack_sdk.users_info };
    constructor(_token: string) {}
  },
}));

describe('Slack channel event dispatch keeps guest flags', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    slack_sdk.users_info.mockReset();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('carries is_restricted and is_ultra_restricted from Slack into the dispatched member record', async () => {
    slack_sdk.users_info.mockResolvedValue({
      ok: true,
      user: {
        id: 'U_GUEST',
        name: 'guest-user',
        is_restricted: true,
        is_ultra_restricted: true,
        profile: { display_name: 'Guest User' },
      },
    });

    const message = await build_slack_channel_message(
      build_connection(),
      'T123',
      build_event('U_GUEST'),
    );

    expect(message?.user_profile).toMatchObject({
      is_restricted: true,
      is_ultra_restricted: true,
    });
  });

  it('defaults both guest flags to false when Slack reports a full member', async () => {
    slack_sdk.users_info.mockResolvedValue({
      ok: true,
      user: {
        id: 'U_FULL',
        name: 'full-member',
        profile: { display_name: 'Full Member' },
      },
    });

    const message = await build_slack_channel_message(
      build_connection(),
      'T123',
      build_event('U_FULL'),
    );

    expect(message?.user_profile).toMatchObject({
      is_restricted: false,
      is_ultra_restricted: false,
    });
  });
});

function build_connection(): SlackEventConnection {
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'guest-flags-test-key';
  return {
    connection_id: 'conn_slack_guest_flags',
    workspace_id: 'ws_guest_flags',
    connection_status: 'active',
    last_updated_by: 'system',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'xoxb-guest-flags' },
    }),
    provider_account: { team_id: 'T123', bot_user_id: 'B123' },
  };
}

function build_event(user_id: string): SlackMessageEvent {
  return {
    type: 'app_mention',
    channel: 'C123',
    channel_type: 'channel',
    user: user_id,
    ts: '1700000000.000001',
    text: '<@B123> status?',
  };
}
