import {
  authorize_slack_channel_message,
  build_slack_external_conversation_key,
  is_slack_thread_reply,
  resolve_slack_channel_conversation,
  resolve_slack_thread_ts,
  type SlackChannelMessage,
} from '@runtime-platform/channels/slack/channel_routing';
import { describe, expect, it } from 'vitest';

describe('Slack channel routing', () => {
  it('uses the Slack thread timestamp for real thread conversations', () => {
    const target = slack_target({ event_ts: '1700000000.000001', thread_ts: '1699999999.000001' });

    expect(resolve_slack_thread_ts(target)).toBe('1699999999.000001');
    expect(resolve_slack_channel_conversation(target)).toEqual({
      scope: 'thread',
      external_thread_key: 'slack:T123:C123:thread:1699999999.000001',
      thread_ts: '1699999999.000001',
    });
  });

  it('uses each top-level channel message as its Slack thread root', () => {
    const first = slack_target({ event_ts: '1700000000.000001' });
    const second = slack_target({ event_ts: '1700000001.000001' });

    expect(resolve_slack_thread_ts(first)).toBe('1700000000.000001');
    expect(build_slack_external_conversation_key(first)).toBe(
      'slack:T123:C123:thread:1700000000.000001',
    );
    expect(build_slack_external_conversation_key(second)).toBe(
      'slack:T123:C123:thread:1700000001.000001',
    );
  });

  it('does not treat Slack thread_ts equal to event_ts as a real reply', () => {
    const target = slack_target({
      event_ts: '1700000000.000001',
      thread_ts: '1700000000.000001',
    });

    expect(is_slack_thread_reply(target)).toBe(false);
    expect(resolve_slack_channel_conversation(target)).toEqual({
      scope: 'thread',
      external_thread_key: 'slack:T123:C123:thread:1700000000.000001',
      thread_ts: '1700000000.000001',
    });
  });

  it('uses distinct stable scopes for DMs and group DMs', () => {
    expect(
      build_slack_external_conversation_key(
        slack_target({ channel_id: 'D123', channel_type: 'im' }),
      ),
    ).toBe('slack:T123:D123:dm');
    expect(
      build_slack_external_conversation_key(
        slack_target({ channel_id: 'G123', channel_type: 'mpim' }),
      ),
    ).toBe('slack:T123:G123:group');
  });

  it('applies channel and user permission policy before the harness accepts a turn', () => {
    expect(
      authorize_slack_channel_message(slack_target({ channel_id: 'C999' }), {
        allowed_channel_ids: ['C123'],
      }),
    ).toMatchObject({ authorized: false, code: 'channel_not_allowed' });

    expect(
      authorize_slack_channel_message(slack_target({ user_id: 'U999' }), {
        allowed_user_ids: ['U123'],
      }),
    ).toMatchObject({ authorized: false, code: 'user_not_allowed' });

    expect(
      authorize_slack_channel_message(slack_target({ channel_type: 'channel' }), {
        require_bot_mention_in_channels: true,
      }),
    ).toMatchObject({ authorized: false, code: 'mention_required' });

    expect(
      authorize_slack_channel_message(
        slack_target({ channel_type: 'channel', mentioned_bot_user_id: 'B123' }),
        { require_bot_mention_in_channels: true },
      ),
    ).toEqual({ authorized: true });
  });

  it('requires a mention in a Slack thread that the agent has not joined', () => {
    expect(
      authorize_slack_channel_message(
        slack_target({
          channel_type: 'channel',
          event_ts: '1700000001.000001',
          thread_ts: '1700000000.000001',
        }),
        { require_bot_mention_in_channels: true },
      ),
    ).toMatchObject({ authorized: false, code: 'mention_required' });
  });

  it('continues a known Slack thread without requiring another mention', () => {
    expect(
      authorize_slack_channel_message(
        slack_target({
          channel_type: 'channel',
          event_ts: '1700000001.000001',
          thread_ts: '1700000000.000001',
        }),
        { require_bot_mention_in_channels: true },
        { known_thread_reply: true },
      ),
    ).toEqual({ authorized: true });
  });
});

function slack_target(overrides: Partial<SlackChannelMessage> = {}): SlackChannelMessage {
  return {
    team_id: 'T123',
    channel_id: 'C123',
    channel_type: 'channel',
    event_ts: '1700000000.000001',
    user_id: 'U123',
    text: 'hello',
    ...overrides,
  };
}
