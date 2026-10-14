import { create_logger, format_error_message } from '@coworker/shared';
import type { WebClient } from '@slack/web-api';

const log = create_logger('slack_turn_stream');

export type SlackTurnStream = {
  channel_id: string;
  message_ts: string;
};

type SlackTurnBlocks = NonNullable<Parameters<WebClient['chat']['stopStream']>[0]['blocks']>;

type SlackTurnStreamReply = {
  text: string;
  blocks?: SlackTurnBlocks;
};

export async function finish_slack_turn_stream(
  slack_api: WebClient,
  stream: SlackTurnStream,
  input: SlackTurnStreamReply,
) {
  const stopped = await slack_api.chat.stopStream({
    channel: stream.channel_id,
    ts: stream.message_ts,
    markdown_text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
  });
  if (!stopped.ok) throw new Error(stopped.error ?? 'Slack rejected the final stream message');
  return { ok: true, ts: stopped.ts ?? stream.message_ts };
}

export async function delete_slack_turn_stream(slack_api: WebClient, stream: SlackTurnStream) {
  try {
    await slack_api.chat.delete({ channel: stream.channel_id, ts: stream.message_ts });
  } catch (error) {
    log.error('Slack turn stream could not be removed after fallback delivery', {
      channel_id: stream.channel_id,
      message_ts: stream.message_ts,
      error: format_error_message(error),
    });
  }
}
