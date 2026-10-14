import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({
  conversations_history: vi.fn(),
  conversations_replies: vi.fn(),
  chat_post_message: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    conversations = {
      history: slack_sdk.conversations_history,
      replies: slack_sdk.conversations_replies,
    };
    chat = { postMessage: slack_sdk.chat_post_message };
  },
}));

import { post_slack_message } from '@runtime-platform/tools/slack/channels_api';

describe('Slack channels API', () => {
  beforeEach(() => {
    slack_sdk.conversations_history.mockReset();
    slack_sdk.conversations_replies.mockReset();
    slack_sdk.chat_post_message.mockReset();
  });

  it('finds an idempotent message on a later history page without reposting it', async () => {
    slack_sdk.conversations_history
      .mockResolvedValueOnce({
        ok: true,
        messages: [],
        response_metadata: { next_cursor: 'second_page' },
      })
      .mockResolvedValueOnce({
        ok: true,
        messages: [
          {
            ts: '1710000000.000777',
            metadata: {
              event_type: 'alfera_idempotent_message',
              event_payload: { idempotency_key: 'discovery:run_1' },
            },
          },
        ],
        response_metadata: { next_cursor: '' },
      });

    const message_ts = await post_slack_message('xoxb-test', 'C123', 'Discovery complete.', {
      idempotency_key: 'discovery:run_1',
      reconcile_before_post: true,
    });

    expect(message_ts).toBe('1710000000.000777');
    expect(slack_sdk.conversations_history).toHaveBeenCalledTimes(2);
    expect(slack_sdk.conversations_history.mock.calls[1]?.[0]).toMatchObject({
      channel: 'C123',
      cursor: 'second_page',
    });
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
  });

  it('marks a new message with its idempotency key', async () => {
    slack_sdk.conversations_history.mockResolvedValue({ ok: true, messages: [] });
    slack_sdk.chat_post_message.mockResolvedValue({ ok: true, ts: '1710000000.000778' });

    await post_slack_message('xoxb-test', 'C123', 'Discovery complete.', {
      idempotency_key: 'discovery:run_2',
      reconcile_before_post: true,
    });

    expect(slack_sdk.chat_post_message).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'Discovery complete.',
      metadata: {
        event_type: 'alfera_idempotent_message',
        event_payload: { idempotency_key: 'discovery:run_2' },
      },
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('finds an idempotent reply inside the target thread', async () => {
    slack_sdk.conversations_replies.mockResolvedValue({
      ok: true,
      messages: [
        {
          ts: '1710000000.000779',
          metadata: {
            event_type: 'alfera_idempotent_message',
            event_payload: { idempotency_key: 'connection_resume:ws_1:conn_docs' },
          },
        },
      ],
    });

    const message_ts = await post_slack_message('xoxb-test', 'C123', 'Connected — on it.', {
      thread_ts: '1700000000.000001',
      idempotency_key: 'connection_resume:ws_1:conn_docs',
      reconcile_before_post: true,
    });

    expect(message_ts).toBe('1710000000.000779');
    expect(slack_sdk.conversations_replies).toHaveBeenCalledWith({
      channel: 'C123',
      ts: '1700000000.000001',
      include_all_metadata: true,
      limit: 100,
    });
    expect(slack_sdk.chat_post_message).not.toHaveBeenCalled();
  });

  it('converts Markdown exactly once and leaves hand-authored text alone', async () => {
    slack_sdk.chat_post_message.mockResolvedValue({ ok: true, ts: '1710000000.000780' });

    await post_slack_message('xoxb-test', 'C123', '**Q3** and *notes*');
    expect(slack_sdk.chat_post_message.mock.calls[0]?.[0]).toMatchObject({
      text: '*Q3* and _notes_',
    });

    await post_slack_message('xoxb-test', 'C123', 'Discovery complete.');
    expect(slack_sdk.chat_post_message.mock.calls[1]?.[0]).toMatchObject({
      text: 'Discovery complete.',
    });
  });
});
