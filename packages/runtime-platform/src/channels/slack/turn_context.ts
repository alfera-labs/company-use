import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

export type TrustedSlackTurnContext = {
  connection_id: string;
  channel_id: string;
  thread_ts: string;
  queue_key: string;
  team_id?: string;
  user_id?: string;
  stream_message_ts?: string;
};

export function read_trusted_slack_turn_context(
  source_context?: RuntimeToolSourceContext,
): TrustedSlackTurnContext | null {
  if (source_context?.source_type !== 'slack') return null;

  const slack = source_context.source_metadata?.slack;
  if (!slack?.connection_id || !slack.channel_id || !slack.event_ts || !slack.turn_subject_key) {
    return null;
  }
  const thread_ts = slack.thread_ts ?? slack.event_ts;

  return {
    connection_id: slack.connection_id,
    channel_id: slack.channel_id,
    thread_ts,
    queue_key: slack.turn_subject_key,
    ...(slack.team_id ? { team_id: slack.team_id } : {}),
    ...(slack.user_id ? { user_id: slack.user_id } : {}),
    ...(slack.stream_message_ts ? { stream_message_ts: slack.stream_message_ts } : {}),
  };
}
