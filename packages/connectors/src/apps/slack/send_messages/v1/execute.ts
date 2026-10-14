import definition from '@connectors/apps/slack/send_messages/v1/node.json' with { type: 'json' };
import { type SlackEnvelope, throw_on_slack_error } from '@connectors/apps/slack/slack_envelope';
import { define_connector_execute } from '@connectors/define_connector_execute';
import { as_connector_error } from '@connectors/runtime/fan_out';
import type { ConnectorError, ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

type OutgoingMessage = {
  channel_id: string;
  text: string;
  thread_ts?: string;
};

type SentMessage = {
  index: number;
  channel_id: string;
  ok: boolean;
  message_ts: string | null;
  thread_ts: string | null;
  error_code: string | null;
  error_message: string | null;
};

type SendMessagesInput = { messages: OutgoingMessage[] };
type SendMessagesOutput = { results: SentMessage[] };

type MessageInGroup = { index: number; message: OutgoingMessage };
type ChannelGroup = { channel_id: string; entries: MessageInGroup[] };

type PostMessageResponse = SlackEnvelope & {
  channel?: string;
  ts?: string;
  message?: { ts?: string; thread_ts?: string };
};

const post_message = definition.requests.post_message;
const response_schema = post_message.response_schema as JsonSchema;

function group_messages_by_channel(messages: readonly OutgoingMessage[]): ChannelGroup[] {
  const groups = new Map<string, ChannelGroup>();
  for (const [index, message] of messages.entries()) {
    const group = groups.get(message.channel_id) ?? { channel_id: message.channel_id, entries: [] };
    group.entries.push({ index, message });
    groups.set(message.channel_id, group);
  }
  return [...groups.values()];
}

function build_failed_message(entry: MessageInGroup, error: ConnectorError): SentMessage {
  return {
    index: entry.index,
    channel_id: entry.message.channel_id,
    ok: false,
    message_ts: null,
    thread_ts: null,
    error_code: error.code,
    error_message: error.message,
  };
}

async function post_one_message(
  entry: MessageInGroup,
  context: ConnectorNodeContext,
): Promise<SentMessage> {
  try {
    const response = await context.send_request<PostMessageResponse>({
      method: 'POST',
      path: post_message.path,
      body: {
        channel: entry.message.channel_id,
        text: entry.message.text,
        ...(entry.message.thread_ts ? { thread_ts: entry.message.thread_ts } : {}),
      },
      response_schema,
    });
    throw_on_slack_error(response, 'chat.postMessage');
    return {
      index: entry.index,
      channel_id: response.channel ?? entry.message.channel_id,
      ok: true,
      message_ts: response.ts ?? null,
      thread_ts: response.message?.thread_ts ?? null,
      error_code: null,
      error_message: null,
    };
  } catch (error) {
    return build_failed_message(entry, as_connector_error(error));
  }
}

async function post_channel_messages_in_order(
  group: ChannelGroup,
  context: ConnectorNodeContext,
): Promise<SentMessage[]> {
  const sent: SentMessage[] = [];
  for (const entry of group.entries) {
    sent.push(await post_one_message(entry, context));
  }
  return sent;
}

export const execute = define_connector_execute<SendMessagesInput, SendMessagesOutput>(
  async (input, context) => {
    const groups = group_messages_by_channel(input.messages);
    const group_results = await context.fan_out({
      items: groups,
      limits: context.app.rate_limits,
      call_one: (group) => post_channel_messages_in_order(group, context),
    });

    const sent = group_results.flatMap((result) => {
      const group = groups[result.index];
      if (!group) throw new Error(`fan_out returned an unknown group index: ${result.index}`);
      if (result.ok) return result.data;
      return group.entries.map((entry) => build_failed_message(entry, result.error));
    });

    return { results: sent.sort((left, right) => left.index - right.index) };
  },
);
