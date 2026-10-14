import { connections, type Database } from '@coworker/core';
import type {
  ConnectionCredentialData,
  ProviderAccountData,
  SlackSourceMetadataData,
} from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import {
  is_slack_thread_reply,
  normalize_slack_message_text,
  type SlackChannelMessage,
} from '@runtime-platform/channels/slack/channel_routing';
import type { StartAgentRunPriorMessage } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { type ConversationsRepliesResponse, WebClient } from '@slack/web-api';
import { and, eq } from 'drizzle-orm';

type SlackReply = NonNullable<ConversationsRepliesResponse['messages']>[number] & {
  subtype?: string;
};
export type SlackThreadBackfillPolicy = {
  thread_initial_limit?: number;
  channel_recent_limit?: number;
};

type ExistingSlackSessionMessage = {
  message_role?: string | null;
  content_text?: string | null;
  source_metadata?: SlackSourceMetadataData;
};

type SlackThreadBackfillInput = {
  workspace_id: string;
  connection_id: string;
  message: SlackChannelMessage;
  thread_ts: string;
  policy: SlackThreadBackfillPolicy;
  existing_messages: ExistingSlackSessionMessage[];
};

export async function collect_slack_thread_backfill_messages(
  db: Database,
  input: SlackThreadBackfillInput,
): Promise<StartAgentRunPriorMessage[]> {
  if (!is_slack_thread_reply(input.message)) return [];

  const limit = normalize_history_limit(input.policy.thread_initial_limit);
  if (limit <= 0) return [];

  const connection = await find_active_slack_connection(db, input);
  const token = read_slack_bot_token(connection?.credentials);
  if (!token) return [];

  const bot_user_id = read_bot_user_id(connection?.provider_account);
  const bot_id = read_bot_id(connection?.provider_account);
  const seen_event_ts = new Set(
    input.existing_messages.map(read_slack_source_event_ts).filter(Boolean),
  );
  const seen_content = new Set(
    input.existing_messages.map(read_existing_content_key).filter(Boolean),
  );
  const replies = await fetch_slack_thread_replies(token, {
    channel_id: input.message.channel_id,
    thread_ts: input.thread_ts,
    limit,
  });

  return replies
    .filter((reply) => is_prior_slack_reply(reply, input.message.event_ts))
    .filter((reply) => !seen_event_ts.has(read_slack_message_ts(reply) ?? ''))
    .flatMap((reply) =>
      slack_reply_to_prior_message(reply, {
        message: input.message,
        thread_ts: input.thread_ts,
        bot_user_id,
        bot_id,
      }),
    )
    .filter((message) => !seen_content.has(read_prior_message_content_key(message)));
}

export async function has_slack_bot_participated_in_thread(
  db: Database,
  input: Omit<SlackThreadBackfillInput, 'existing_messages'>,
) {
  if (!is_slack_thread_reply(input.message)) return false;

  const limit = normalize_history_limit(input.policy.thread_initial_limit);
  if (limit <= 0) return false;

  const connection = await find_active_slack_connection(db, input);
  const token = read_slack_bot_token(connection?.credentials);
  if (!token) return false;

  const bot_user_id = read_bot_user_id(connection?.provider_account);
  const bot_id = read_bot_id(connection?.provider_account);
  if (!bot_user_id && !bot_id) return false;

  const replies = await fetch_slack_thread_replies(token, {
    channel_id: input.message.channel_id,
    thread_ts: input.thread_ts,
    limit,
  });

  return replies
    .filter((reply) => is_prior_slack_reply(reply, input.message.event_ts))
    .some(
      (reply) =>
        resolve_slack_history_role(reply, {
          bot_user_id,
          bot_id,
        }) === 'assistant',
    );
}

async function fetch_slack_thread_replies(
  token: string,
  input: { channel_id: string; thread_ts: string; limit: number },
) {
  try {
    const response = await new WebClient(token).conversations.replies({
      channel: input.channel_id,
      ts: input.thread_ts,
      limit: input.limit,
      inclusive: true,
    });
    return response.messages ?? [];
  } catch {
    return [];
  }
}

async function find_active_slack_connection(
  db: Database,
  input: { workspace_id: string; connection_id: string },
) {
  return db.query.connections.findFirst({
    where: and(
      eq(connections.workspace_id, input.workspace_id),
      eq(connections.connection_id, input.connection_id),
      eq(connections.connection_status, 'active'),
    ),
  });
}

function slack_reply_to_prior_message(
  reply: SlackReply,
  context: {
    message: SlackChannelMessage;
    thread_ts: string;
    bot_user_id: string | null;
    bot_id: string | null;
  },
): StartAgentRunPriorMessage[] {
  const event_ts = read_slack_message_ts(reply);
  const text = normalize_slack_message_text(reply.text ?? '', context.bot_user_id);
  const role = resolve_slack_history_role(reply, context);
  if (!event_ts || !text || !role) return [];

  return [
    {
      message_role: role,
      message_content: [{ type: 'text', text: format_history_text(reply, text, context) }],
      source_type: 'slack',
      source_metadata: {
        slack: {
          team_id: context.message.team_id,
          channel_id: context.message.channel_id,
          channel_type: context.message.channel_type,
          event_ts,
          thread_ts: context.thread_ts,
          raw_thread_ts: context.thread_ts,
          conversation_scope: 'thread',
          history_backfill: true,
          user_id: reply.user || undefined,
          bot_id: reply.bot_id || undefined,
        },
      },
    },
  ];
}

function resolve_slack_history_role(
  reply: SlackReply,
  context: { bot_user_id: string | null; bot_id: string | null },
): 'user' | 'assistant' | null {
  const subtype = reply.subtype;
  if (subtype && subtype !== 'bot_message') return null;

  const user_id = reply.user ?? null;
  const bot_id = reply.bot_id ?? null;
  if (is_self_bot_message({ user_id, bot_id }, context)) return 'assistant';
  if (bot_id) return null;
  return user_id ? 'user' : null;
}

function format_history_text(
  reply: SlackReply,
  text: string,
  context: { message: SlackChannelMessage },
) {
  const user_id = reply.user;
  if (!user_id || user_id !== context.message.user_id) return text;

  const display_name =
    context.message.user_profile?.display_name ??
    context.message.user_profile?.real_name ??
    context.message.user_profile?.username;
  if (!display_name) return text;
  return `${display_name}: ${text}`;
}

function is_self_bot_message(
  reply: { user_id: string | null; bot_id: string | null },
  context: { bot_user_id: string | null; bot_id: string | null },
) {
  return Boolean(
    (context.bot_user_id && reply.user_id === context.bot_user_id) ||
      (context.bot_id && reply.bot_id === context.bot_id),
  );
}

function is_prior_slack_reply(reply: SlackReply, current_event_ts: string) {
  const message_ts = read_slack_message_ts(reply);
  if (!message_ts) return false;
  return Number(message_ts) < Number(current_event_ts);
}

function read_slack_source_event_ts(message: ExistingSlackSessionMessage) {
  return message.source_metadata?.slack?.event_ts ?? null;
}

function read_existing_content_key(message: ExistingSlackSessionMessage) {
  if (!message.message_role || !message.content_text) return null;
  return build_content_key(message.message_role, message.content_text);
}

function read_prior_message_content_key(message: StartAgentRunPriorMessage) {
  return build_content_key(message.message_role, read_prior_message_text(message));
}

function read_prior_message_text(message: StartAgentRunPriorMessage) {
  return message.message_content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function build_content_key(role: string, text: string) {
  return `${role}:${text.trim()}`;
}

function read_slack_message_ts(message: SlackReply) {
  return message.ts ?? null;
}

function normalize_history_limit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), 200);
}

function read_slack_bot_token(credentials: ConnectionCredentialData | null | undefined) {
  if (!credentials) return null;
  return (
    read_connection_credential_value(credentials, 'bot_token') ??
    read_connection_credential_value(credentials, 'access_token')
  );
}

function read_bot_user_id(provider_account: ProviderAccountData | null | undefined) {
  return provider_account?.bot_user_id ?? provider_account?.botUserId ?? null;
}

function read_bot_id(provider_account: ProviderAccountData | null | undefined) {
  return provider_account?.bot_id ?? provider_account?.botId ?? null;
}
