import {
  build_channel_records,
  type ChannelRecord,
  is_thread_root,
  type ThreadReplies,
} from '@connectors/apps/slack/list_messages/v1/build_records';
import definition from '@connectors/apps/slack/list_messages/v1/node.json' with { type: 'json' };
import {
  message_is_dropped,
  type SlackRawMessage,
  type UserNames,
} from '@connectors/apps/slack/list_messages/v1/render_message';
import {
  find_next_cursor,
  type SlackEnvelope,
  throw_on_slack_error,
} from '@connectors/apps/slack/slack_envelope';
import { define_connector_execute } from '@connectors/define_connector_execute';
import { ConnectorHttpError } from '@connectors/runtime/http_request';
import type { ConnectorError, ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';
import { format_error_message } from '@coworker/shared';

type ChannelRequest = {
  channel_id: string;
  cursor?: string;
};

type ChannelHistory = {
  channel_id: string;
  channel_name: string;
  ok: boolean;
  records: ChannelRecord[];
  next_cursor: string | null;
  has_more: boolean;
  error_code: string | null;
  error_message: string | null;
};

type ListMessagesInput = {
  channels: ChannelRequest[];
  limit?: number;
  oldest?: string;
  latest?: string;
  timezone?: string;
  team_domain?: string;
};

type ListMessagesOutput = { channels: ChannelHistory[]; timezone: string };

type HistoryWindow = {
  limit?: number | undefined;
  oldest?: string | undefined;
  latest?: string | undefined;
};

type ConversationsHistoryResponse = SlackEnvelope & {
  messages?: SlackRawMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
};

type ConversationsRepliesResponse = SlackEnvelope & {
  messages?: SlackRawMessage[];
  response_metadata?: { next_cursor?: string };
};

type ConversationsInfoResponse = SlackEnvelope & {
  channel?: { id?: string; name?: string };
};

type AuthTestResponse = SlackEnvelope & {
  url?: string;
};

type SlackMember = {
  id: string;
  name?: string;
  real_name?: string;
  tz?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; real_name?: string };
};

type UsersListResponse = SlackEnvelope & {
  members?: SlackMember[];
  response_metadata?: { next_cursor?: string };
};

type WorkspaceDirectory = { names: UserNames; time_zone: string };
type SlackDirectory = WorkspaceDirectory & { archive_origin: string | null };

const conversations_history = definition.requests.conversations_history;
const conversations_replies = definition.requests.conversations_replies;
const conversations_info = definition.requests.conversations_info;
const conversations_join = definition.requests.conversations_join;
const auth_test = definition.requests.auth_test;
const users_list = definition.requests.users_list;
const history_schema = conversations_history.response_schema as JsonSchema;
const replies_schema = conversations_replies.response_schema as JsonSchema;
const info_schema = conversations_info.response_schema as JsonSchema;
const join_schema = conversations_join.response_schema as JsonSchema;
const auth_test_schema = auth_test.response_schema as JsonSchema;
const users_schema = users_list.response_schema as JsonSchema;

const users_per_request = 200;
const user_directory_cap = 2000;
const replies_per_request = 500;
const replies_per_thread_cap = 5000;

const default_time_zone = 'UTC';

const workspace_cache_ttl_ms = 10 * 60 * 1000;
const workspace_cache_size = 100;
const workspace_cache = new Map<string, { stored_at_ms: number; value: Promise<unknown> }>();

function read_once<TValue>(key: string, read: () => Promise<TValue>): Promise<TValue> {
  const cached = workspace_cache.get(key);
  if (cached && Date.now() - cached.stored_at_ms < workspace_cache_ttl_ms)
    return cached.value as Promise<TValue>;
  const value = read();
  workspace_cache.delete(key);
  workspace_cache.set(key, { stored_at_ms: Date.now(), value });
  while (workspace_cache.size > workspace_cache_size) {
    const oldest = workspace_cache.keys().next().value;
    if (oldest === undefined) break;
    workspace_cache.delete(oldest);
  }
  return value;
}

export function reset_slack_workspace_cache() {
  workspace_cache.clear();
}

async function read_directory(context: ConnectorNodeContext): Promise<WorkspaceDirectory> {
  const names: UserNames = new Map();
  const zones = new Map<string, number>();
  let cursor: string | undefined;
  try {
    while (names.size < user_directory_cap) {
      const response = await context.send_request<UsersListResponse>({
        method: 'GET',
        path: users_list.path,
        query: { cursor, limit: users_per_request },
        response_schema: users_schema,
      });
      throw_on_slack_error(response, 'users.list');
      for (const member of response.members ?? []) {
        names.set(member.id, read_member_name(member));
        count_member_zone(zones, member);
      }
      cursor = find_next_cursor(response.response_metadata) ?? undefined;
      if (!cursor) break;
    }
  } catch (error) {
    context.log.warn('Slack users.list failed; messages keep their raw user ids', {
      connection_id: context.connection.connection_id,
      error: format_error_message(error),
    });
  }
  return { names, time_zone: most_common_zone(zones) };
}

function read_member_name(member: SlackMember): string {
  return (
    member.profile?.display_name ||
    member.profile?.real_name ||
    member.real_name ||
    member.name ||
    member.id
  );
}

function count_member_zone(zones: Map<string, number>, member: SlackMember) {
  if (member.deleted || member.is_bot || !member.tz) return;
  zones.set(member.tz, (zones.get(member.tz) ?? 0) + 1);
}

function most_common_zone(zones: Map<string, number>): string {
  let winner = default_time_zone;
  let best = 0;
  for (const [zone, count] of zones) {
    if (count <= best) continue;
    best = count;
    winner = zone;
  }
  return winner;
}

function by_timestamp(left: SlackRawMessage, right: SlackRawMessage) {
  return Number(left.ts) - Number(right.ts);
}

async function read_thread_replies(
  channel_id: string,
  parent: SlackRawMessage,
  context: ConnectorNodeContext,
): Promise<ThreadReplies> {
  const replies: SlackRawMessage[] = [];
  let cursor: string | undefined;
  while (replies.length < replies_per_thread_cap) {
    const response = await context.send_request<ConversationsRepliesResponse>({
      method: 'GET',
      path: conversations_replies.path,
      query: { channel: channel_id, ts: parent.ts, limit: replies_per_request, cursor },
      response_schema: replies_schema,
    });
    throw_on_slack_error(response, 'conversations.replies');
    for (const message of response.messages ?? []) {
      if (message.ts !== parent.ts) replies.push(message);
    }
    cursor = find_next_cursor(response.response_metadata) ?? undefined;
    if (!cursor) break;
  }
  return { replies: replies.sort(by_timestamp), truncated: Boolean(cursor) };
}

async function read_page_threads(
  channel_id: string,
  roots: SlackRawMessage[],
  context: ConnectorNodeContext,
): Promise<Map<string, ThreadReplies>> {
  const results = await context.fan_out({
    items: roots,
    limits: context.app.rate_limits,
    call_one: (parent) => read_thread_replies(channel_id, parent, context),
  });

  const replies_by_parent = new Map<string, ThreadReplies>();
  const failures: string[] = [];
  for (const result of results) {
    const parent = roots[result.index];
    if (!parent) continue;
    if (result.ok) replies_by_parent.set(parent.ts, result.data);
    else failures.push(`${parent.ts} (${result.error.message})`);
  }
  if (failures.length > 0) {
    throw new ConnectorHttpError(
      'provider_error',
      `Slack conversations.replies failed for ${failures.length} thread(s) in ${channel_id}: ${failures.join('; ')}. ` +
        'The page is refused rather than stored without them, so the sync re-reads it instead of moving past threads it never read.',
      200,
      true,
    );
  }
  return replies_by_parent;
}

async function read_archive_origin(context: ConnectorNodeContext): Promise<string | null> {
  try {
    const response = await context.send_request<AuthTestResponse>({
      method: 'POST',
      path: auth_test.path,
      response_schema: auth_test_schema,
    });
    throw_on_slack_error(response, 'auth.test');
    return response.url ? new URL(response.url).origin : null;
  } catch (error) {
    context.log.warn('Slack auth.test failed; the messages keep their text and lose their links', {
      connection_id: context.connection.connection_id,
      error: format_error_message(error),
    });
    return null;
  }
}

async function read_channel_name(
  channel_id: string,
  context: ConnectorNodeContext,
): Promise<string> {
  try {
    const response = await context.send_request<ConversationsInfoResponse>({
      method: 'GET',
      path: conversations_info.path,
      query: { channel: channel_id },
      response_schema: info_schema,
    });
    throw_on_slack_error(response, 'conversations.info');
    return response.channel?.name ?? channel_id;
  } catch (error) {
    context.log.warn('Slack conversations.info failed; the channel keeps its id as its name', {
      channel_id,
      error: format_error_message(error),
    });
    return channel_id;
  }
}

function drop_broadcast_replies(messages: SlackRawMessage[]): SlackRawMessage[] {
  const timestamps = new Set(messages.map((message) => message.ts));
  return messages.filter(
    (message) =>
      !message.thread_ts || message.thread_ts === message.ts || !timestamps.has(message.thread_ts),
  );
}

async function join_channel(channel_id: string, context: ConnectorNodeContext) {
  const response = await context.send_request<SlackEnvelope>({
    method: 'POST',
    path: conversations_join.path,
    body: { channel: channel_id },
    response_schema: join_schema,
  });
  if (response.ok) return;
  throw new ConnectorHttpError(
    'provider_error',
    `Slack conversations.join answered ok=false: ${response.error ?? 'unknown_error'}. ` +
      `The bot is not a member of ${channel_id}, and a private channel has to invite it: /invite @Alfera.`,
    200,
    false,
  );
}

async function send_history_request(
  request: ChannelRequest,
  window: HistoryWindow,
  context: ConnectorNodeContext,
) {
  return context.send_request<ConversationsHistoryResponse>({
    method: 'GET',
    path: conversations_history.path,
    query: {
      channel: request.channel_id,
      cursor: request.cursor,
      limit: window.limit,
      oldest: window.oldest,
      latest: window.latest,
    },
    response_schema: history_schema,
  });
}

async function read_history_page(
  request: ChannelRequest,
  window: HistoryWindow,
  context: ConnectorNodeContext,
): Promise<ConversationsHistoryResponse> {
  const response = await send_history_request(request, window, context);
  if (response.error !== 'not_in_channel') {
    throw_on_slack_error(response, 'conversations.history');
    return response;
  }

  await join_channel(request.channel_id, context);
  const retried = await send_history_request(request, window, context);
  throw_on_slack_error(retried, 'conversations.history');
  return retried;
}

async function read_one_channel(
  request: ChannelRequest,
  window: HistoryWindow,
  directory: SlackDirectory,
  context: ConnectorNodeContext,
): Promise<ChannelHistory> {
  const response = await read_history_page(request, window, context);
  const messages = drop_broadcast_replies(response.messages ?? []).filter(
    (message) => !message_is_dropped(message),
  );
  const roots = messages.filter(is_thread_root);

  const channel_name = await read_channel_name(request.channel_id, context);
  const replies_by_parent = await read_page_threads(request.channel_id, roots, context);

  return {
    channel_id: request.channel_id,
    channel_name,
    ok: true,
    records: build_channel_records({
      channel_id: request.channel_id,
      channel_name,
      archive_origin: directory.archive_origin,
      messages,
      replies_by_parent,
      names: directory.names,
      time_zone: directory.time_zone,
    }),
    next_cursor: find_next_cursor(response.response_metadata),
    has_more: response.has_more ?? false,
    error_code: null,
    error_message: null,
  };
}

function build_failed_channel(channel_id: string, error: ConnectorError): ChannelHistory {
  return {
    channel_id,
    channel_name: channel_id,
    ok: false,
    records: [],
    next_cursor: null,
    has_more: false,
    error_code: error.code,
    error_message: error.message,
  };
}

export const execute = define_connector_execute<ListMessagesInput, ListMessagesOutput>(
  async (input, context) => {
    const window: HistoryWindow = {
      limit: input.limit,
      oldest: input.oldest,
      latest: input.latest,
    };
    const connection_id = context.connection.connection_id;
    const read = await read_once(`${connection_id}:directory`, () => read_directory(context));
    const directory: SlackDirectory = {
      names: read.names,
      time_zone: input.timezone ?? read.time_zone,
      archive_origin: input.team_domain
        ? `https://${input.team_domain}.slack.com`
        : await read_once(`${connection_id}:archive_origin`, () => read_archive_origin(context)),
    };
    const results = await context.fan_out({
      items: input.channels,
      limits: context.app.rate_limits,
      call_one: (request) => read_one_channel(request, window, directory, context),
    });

    return {
      timezone: directory.time_zone,
      channels: results.map((result) => {
        const request = input.channels[result.index];
        if (!request) throw new Error(`fan_out returned an unknown channel index: ${result.index}`);
        if (result.ok) return result.data;
        return build_failed_channel(request.channel_id, result.error);
      }),
    };
  },
);
