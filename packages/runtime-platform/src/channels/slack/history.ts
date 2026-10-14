import { connections, type Database } from '@coworker/core';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import {
  type ConversationsHistoryResponse,
  type ConversationsListResponse,
  WebClient,
} from '@slack/web-api';
import { and, eq } from 'drizzle-orm';

export type SlackChannelSummary = {
  channel_id: string;
  channel_name: string | null;
  is_member: boolean | null;
};

export type SlackHistoryMessage = {
  message_ts: string;
  user_id: string | null;
  text: string;
  thread_ts: string | null;
  subtype: string | null;
  file_names: string[];
};

export type SlackHistoryPage = {
  messages: SlackHistoryMessage[];
  next_cursor: string | null;
};

const default_channel_page_size = 200;
const default_channel_list_page_size = 200;

export async function find_workspace_slack_connection(
  db: Database,
  workspace_id: string,
  connection_id?: string,
) {
  const filters = [
    eq(connections.workspace_id, workspace_id),
    eq(connections.provider_key, native_slack_provider_key),
    eq(connections.provider_config_key, native_slack_provider_config_key),
    eq(connections.connection_profile_key, native_slack_connection_profile_key),
    eq(connections.connection_status, 'active'),
  ];
  if (connection_id) filters.push(eq(connections.connection_id, connection_id));
  return db.query.connections.findFirst({
    where: and(...filters),
    orderBy: (table, { desc }) => [desc(table.created_time)],
  });
}

export function read_slack_bot_token(
  credentials: ConnectionCredentialData | null | undefined,
): string | null {
  if (!credentials) return null;
  return (
    read_connection_credential_value(credentials, 'bot_token') ??
    read_connection_credential_value(credentials, 'access_token') ??
    null
  );
}

export async function list_all_workspace_slack_channels(token: string) {
  const client = new WebClient(token);
  const channels: SlackChannelSummary[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.conversations.list({
      limit: default_channel_list_page_size,
      types: 'public_channel,private_channel',
      exclude_archived: true,
      ...(cursor ? { cursor } : {}),
    });
    for (const channel of response.channels ?? []) {
      const summary = normalize_channel_summary(channel);
      if (summary) channels.push(summary);
    }
    cursor = normalize_next_cursor(response.response_metadata?.next_cursor) ?? undefined;
  } while (cursor);
  return channels;
}

export async function fetch_slack_channel_history_page(
  token: string,
  input: {
    channel_id: string;
    cursor?: string;
    limit?: number;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
  },
): Promise<SlackHistoryPage> {
  const response = await new WebClient(token).conversations.history({
    channel: input.channel_id,
    limit: input.limit ?? default_channel_page_size,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.oldest ? { oldest: input.oldest } : {}),
    ...(input.latest ? { latest: input.latest } : {}),
    ...(typeof input.inclusive === 'boolean' ? { inclusive: input.inclusive } : {}),
  });
  return {
    messages: (response.messages ?? []).flatMap(normalize_history_message),
    next_cursor: normalize_next_cursor(response.response_metadata?.next_cursor),
  };
}

// One page of a thread's replies. conversations.history only returns a channel's surface
// messages — the conversation inside a thread is reachable ONLY through conversations.replies,
// so discovery calls this for each thread parent it finds.
export async function fetch_slack_thread_replies_page(
  token: string,
  input: { channel_id: string; thread_ts: string; limit?: number },
): Promise<SlackHistoryPage> {
  const response = await new WebClient(token).conversations.replies({
    channel: input.channel_id,
    ts: input.thread_ts,
    limit: input.limit ?? default_channel_page_size,
  });
  return {
    messages: (response.messages ?? []).flatMap(normalize_history_message),
    next_cursor: normalize_next_cursor(response.response_metadata?.next_cursor),
  };
}

function normalize_channel_summary(
  value: NonNullable<ConversationsListResponse['channels']>[number],
): SlackChannelSummary | null {
  const channel_id = value.id;
  if (!channel_id) return null;
  return {
    channel_id,
    channel_name: value.name || null,
    is_member: value.is_member ?? null,
  };
}

function normalize_history_message(
  value: NonNullable<ConversationsHistoryResponse['messages']>[number],
): SlackHistoryMessage[] {
  const message_ts = value.ts;
  if (!message_ts) return [];
  return [
    {
      message_ts,
      text: value.text ?? '',
      user_id: value.user ?? null,
      thread_ts: value.thread_ts ?? null,
      subtype: value.subtype ?? null,
      file_names: (value.files ?? []).flatMap((file) => file.name ?? file.title ?? []),
    },
  ];
}

function normalize_next_cursor(value: string | undefined): string | null {
  return value || null;
}
