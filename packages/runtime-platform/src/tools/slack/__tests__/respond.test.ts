import type { Database } from '@coworker/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post_message = vi.fn();
const delete_message = vi.fn();
vi.mock('@runtime-platform/channels/slack/web_api', () => ({
  create_slack_web_api: vi.fn(async () => ({
    chat: { postMessage: post_message, delete: delete_message },
  })),
}));
vi.mock('@runtime-platform/tools/catalog_tool_execution', () => ({
  execute_catalog_tool: vi.fn(async () => {
    throw new Error('the reply must not go through the catalog access check');
  }),
}));

import { slack_respond_tool } from '@runtime-platform/tools/slack/respond';

const shared_channel_turn = {
  db: {} as Database,
  workspace_id: 'ws_1',
  session_id: 'ses_1',
  run_id: 'run_1',
  actor_id: 'user_owner',
  participants: { project: [], user: ['user_owner', 'user_teammate'], agent: [] },
  room_private_to: null,
  source_context: {
    source_type: 'slack',
    source_metadata: {
      slack: {
        connection_id: 'conn_slack',
        channel_id: 'C123',
        event_ts: '1700000000.000100',
        thread_ts: '1700000000.000100',
        turn_subject_key: 'slack:T123:C123:thread:1700000000.000100',
      },
    },
  },
} as unknown as Parameters<NonNullable<typeof slack_respond_tool.execute>>[1];

describe('slack-respond-1', () => {
  beforeEach(() => {
    post_message.mockReset().mockResolvedValue({ ok: true, ts: '1700000001.000200' });
  });

  it('answers in the thread through the turn’s own bot, even in a shared room', async () => {
    const result = await slack_respond_tool.execute(
      { resolution_type: 'reply', message: 'I’m here, **Rod**.' },
      shared_channel_turn,
    );

    expect(result).toMatchObject({
      success: true,
      data: { delivered: true, message_ts: '1700000001.000200' },
    });
    expect(post_message).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123',
        thread_ts: '1700000000.000100',
        text: 'I’m here, *Rod*.',
      }),
    );
  });

  it('says why when Slack refuses the post', async () => {
    post_message.mockRejectedValue(new Error('An API error occurred: not_in_channel'));

    const result = await slack_respond_tool.execute(
      { resolution_type: 'reply', message: 'Hello' },
      shared_channel_turn,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'slack_reply_failed', message: 'An API error occurred: not_in_channel' },
    });
  });
});
