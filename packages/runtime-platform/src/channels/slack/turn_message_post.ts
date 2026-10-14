import { create_logger, format_error_message } from '@coworker/shared';
import { slack_message_text_from_markdown } from '@runtime-platform/channels/slack/message_format';
import {
  delete_slack_turn_stream,
  finish_slack_turn_stream,
} from '@runtime-platform/channels/slack/turn_stream';
import type { WebClient } from '@slack/web-api';

const log = create_logger('slack_turn_finalize');

/**
 * Posts the model's raw Markdown as the Slack turn reply. The streaming finish sends
 * `markdown_text`, which Slack renders as Markdown itself, so only the plain chat.postMessage
 * fallback needs the mrkdwn translation.
 */
export async function post_slack_turn_message(
  slack_api: WebClient,
  target: { channel_id: string; thread_ts: string; stream_message_ts?: string },
  input: { text: string },
) {
  const stream = target.stream_message_ts
    ? { channel_id: target.channel_id, message_ts: target.stream_message_ts }
    : null;
  if (stream) {
    try {
      return await finish_slack_turn_stream(slack_api, stream, input);
    } catch (error) {
      log.error('Slack recovery stream failed; posting a normal reply', {
        channel_id: target.channel_id,
        thread_ts: target.thread_ts,
        stream_message_ts: target.stream_message_ts,
        error: format_error_message(error),
      });
    }
  }

  const posted = (await slack_api.apiCall('chat.postMessage', {
    channel: target.channel_id,
    thread_ts: target.thread_ts,
    text: slack_message_text_from_markdown(input.text),
    unfurl_links: false,
    unfurl_media: false,
  })) as { ok: boolean; ts?: string };
  if (stream) await delete_slack_turn_stream(slack_api, stream);
  return posted;
}
