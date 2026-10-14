import type { SlackChannelMessage } from '@runtime-platform/channels/slack/channel_routing';
import { resolve_slack_conversation_label } from '@runtime-platform/channels/slack/conversation_label';
import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';

function slack_api(info: () => Promise<unknown>) {
  return { conversations: { info } } as unknown as WebClient;
}

function slack_message(fields: Partial<SlackChannelMessage>): SlackChannelMessage {
  return {
    team_id: 'T123',
    channel_id: 'C123',
    channel_type: 'channel',
    event_ts: '1700000000.000001',
    user_id: 'U123',
    ...fields,
  };
}

describe('Slack conversation label', () => {
  it('names a channel', async () => {
    const info = vi.fn().mockResolvedValue({ ok: true, channel: { name: 'support' } });

    expect(await resolve_slack_conversation_label(slack_api(info), slack_message({}))).toBe(
      '#support',
    );
    expect(info).toHaveBeenCalledWith({ channel: 'C123' });
  });

  it('names a direct message after the sender, without asking Slack', async () => {
    const info = vi.fn();
    const message = slack_message({
      channel_type: 'im',
      channel_id: 'D123',
      user_profile: { display_name: 'oli' },
    });

    expect(await resolve_slack_conversation_label(slack_api(info), message)).toBe('@oli');
    expect(info).not.toHaveBeenCalled();
  });

  it('falls back to the channel id when Slack will not name the channel', async () => {
    const info = vi.fn().mockRejectedValue(new Error('channel_not_found'));

    expect(await resolve_slack_conversation_label(slack_api(info), slack_message({}))).toBe('C123');
  });
});
