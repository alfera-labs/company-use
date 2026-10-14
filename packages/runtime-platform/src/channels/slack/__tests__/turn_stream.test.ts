import { finish_slack_turn_stream } from '@runtime-platform/channels/slack/turn_stream';
import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';

describe('Slack turn stream', () => {
  it('finishes the active stream with the final text and blocks in one request', async () => {
    const stop_stream = vi.fn().mockResolvedValue({ ok: true, ts: '1710000000.000050' });
    const slack_api = {
      chat: { stopStream: stop_stream },
    } as unknown as WebClient;
    const blocks = [{ type: 'actions', elements: [] }];

    await finish_slack_turn_stream(
      slack_api,
      { channel_id: 'C123', message_ts: '1710000000.000050' },
      { text: '**Done:** [Open the document](https://example.com/doc)', blocks },
    );

    expect(stop_stream).toHaveBeenCalledWith({
      channel: 'C123',
      ts: '1710000000.000050',
      markdown_text: '**Done:** [Open the document](https://example.com/doc)',
      blocks,
    });
  });
});
