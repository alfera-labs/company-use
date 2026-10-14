import type {
  SlackSourceMetadataData,
  ToolInputData,
} from '@coworker/core/db/schema/json_column_types';

const slack_reply_tool_names = new Set(['slack-respond-1', 'slack-send_message-1']);

const completed_tool_status = 'completed';

export type SlackTurnResolutionToolCall = {
  tool_name: string;
  tool_status: string;
  input_data?: ToolInputData | null;
  output_data?: unknown;
  error_message?: string | null;
  created_time?: Date;
};

export type SlackTurnResolutionInput = {
  turn_channel_id: string;
  tool_calls: SlackTurnResolutionToolCall[];
};

export function slack_turn_was_resolved(input: SlackTurnResolutionInput): boolean {
  return input.tool_calls.some((call) => is_completed_turn_reply(call, input.turn_channel_id));
}

function is_completed_turn_reply(call: SlackTurnResolutionToolCall, turn_channel_id: string) {
  if (call.tool_status !== completed_tool_status) return false;
  if (!slack_reply_tool_names.has(call.tool_name)) return false;
  if (call.tool_name === 'slack-respond-1') {
    return call.input_data?.keep_working !== true;
  }
  return call.input_data?.channel_id === turn_channel_id;
}

export type SlackTurnRecoveryMessage = {
  message_role: string;
  message_kind: string;
  is_user_visible: boolean;
  content_text: string | null;
  created_time: Date;
  source_metadata?: SlackSourceMetadataData;
};

export type SlackTurnRecoveredReply = {
  message: string;
  reply_source: 'reply_tool_input' | 'assistant_output';
};

export function select_slack_turn_recovered_reply(input: {
  turn_channel_id: string;
  tool_calls: SlackTurnResolutionToolCall[];
  run_messages: SlackTurnRecoveryMessage[];
}): SlackTurnRecoveredReply | null {
  const failed_reply = last_failed_reply_attempt(input.tool_calls, input.turn_channel_id);
  const final_output = last_user_visible_assistant_output(input.run_messages);
  if (!failed_reply && !final_output) return null;
  if (failed_reply && final_output) {
    return failed_reply.authored_time >= final_output.authored_time
      ? failed_reply.reply
      : final_output.reply;
  }
  return (failed_reply ?? final_output)?.reply ?? null;
}

function last_failed_reply_attempt(
  tool_calls: SlackTurnResolutionToolCall[],
  turn_channel_id: string,
) {
  const attempts = tool_calls.filter(
    (call) =>
      call.tool_status !== completed_tool_status && is_turn_reply_input(call, turn_channel_id),
  );
  const last = attempts.at(-1);
  const message = last ? parse_reply_message(last)?.trim() : undefined;
  if (!last || !message) return null;

  return {
    authored_time: last.created_time?.getTime() ?? 0,
    reply: { message, reply_source: 'reply_tool_input' as const },
  };
}

function is_turn_reply_input(call: SlackTurnResolutionToolCall, turn_channel_id: string) {
  if (call.tool_name === 'slack-respond-1') {
    const input = call.input_data;
    return input?.resolution_type === 'reply' && input.keep_working !== true;
  }
  if (call.tool_name === 'slack-send_message-1') {
    const input = call.input_data;
    return input?.channel_id === turn_channel_id;
  }
  return false;
}

function last_user_visible_assistant_output(run_messages: SlackTurnRecoveryMessage[]) {
  const outputs = run_messages.filter(
    (message) =>
      message.message_role === 'assistant' &&
      message.message_kind === 'output' &&
      message.is_user_visible &&
      !is_history_backfill(message) &&
      is_terminal_assistant_output(message) &&
      Boolean(message.content_text?.trim()),
  );
  const last = outputs.at(-1);
  const message = last?.content_text?.trim();
  if (!last || !message) return null;

  return {
    authored_time: last.created_time.getTime(),
    reply: { message, reply_source: 'assistant_output' as const },
  };
}

function is_terminal_assistant_output(message: SlackTurnRecoveryMessage) {
  const stop_reason = message.source_metadata?.provider_metadata?.stop_reason;
  return !stop_reason || stop_reason === 'stop';
}

function is_history_backfill(message: SlackTurnRecoveryMessage) {
  return message.source_metadata?.slack?.history_backfill === true;
}

function parse_reply_message(call: SlackTurnResolutionToolCall) {
  if (call.tool_name === 'slack-respond-1') {
    return call.input_data?.message;
  }
  if (call.tool_name === 'slack-send_message-1') {
    return call.input_data?.message;
  }
  return undefined;
}
