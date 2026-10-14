import type {
  ConnectionConfigData,
  ConnectionCredentialData,
  ProviderAccountData,
} from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import { slack_message_text_from_markdown } from '@runtime-platform/channels/slack/message_format';
import { slack_call } from '@runtime-platform/tools/slack/slack_call';
import type { ConversationsListResponse, KnownBlock, WebAPICallResult } from '@slack/web-api';
import { WebClient } from '@slack/web-api';

export type SlackCredentialConnection = {
  connection_id?: string;
  credentials?: ConnectionCredentialData | null;
  provider_account?: ProviderAccountData | null;
  connection_config?: ConnectionConfigData | null;
};

type SlackChannel = NonNullable<ConversationsListResponse['channels']>[number];

type SlackIdempotencyMetadata = {
  event_type?: string;
  event_payload?: { idempotency_key?: string };
};

export type SlackChannelSummary = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members: number | null;
};

export type SlackChannelPage = {
  channels: SlackChannelSummary[];
  next_cursor: string | null;
};

export type SlackChannelVisibility = 'public' | 'private';

export function create_slack_web_client(
  token: string,
  options?: ConstructorParameters<typeof WebClient>[1],
) {
  return new WebClient(token, options);
}

// Onboarding's bulk channel work can trip Slack's per-method rate limits. Reject 429s
// immediately instead of sleeping out the server's Retry-After (which can be 30s+ and blow the
// request/proxy timeout); still retry transient network/5xx errors twice. The agent runtime
// keeps the SDK default (long backoff) elsewhere.
const onboarding_slack_client_options = {
  rejectRateLimitedCalls: true,
  retryConfig: { retries: 2 },
};

export function read_slack_bot_token(connection: SlackCredentialConnection | null) {
  if (!connection) return null;
  return (
    [
      connection.credentials
        ? read_connection_credential_value(connection.credentials, 'bot_token')
        : null,
      connection.credentials
        ? read_connection_credential_value(connection.credentials, 'access_token')
        : null,
      connection.credentials?.bot_token,
      connection.credentials?.access_token,
      connection.provider_account?.bot_token,
      connection.provider_account?.access_token,
      connection.connection_config?.bot_token,
    ].find((value) => Boolean(value)) ?? null
  );
}

export async function fetch_public_slack_channels(
  token: string,
  input: { cursor?: string; limit?: number } = {},
): Promise<SlackChannelPage> {
  return fetch_slack_channels(token, { ...input, visibility: 'public' });
}

export async function fetch_slack_channels(
  token: string,
  input: { visibility: SlackChannelVisibility; cursor?: string; limit?: number },
): Promise<SlackChannelPage> {
  const response = await slack_call(() =>
    create_slack_web_client(token, onboarding_slack_client_options).conversations.list({
      limit: clamp(input.limit ?? 200, 1, 1000),
      types: input.visibility === 'private' ? 'private_channel' : 'public_channel',
      exclude_archived: true,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    }),
  );

  return {
    channels: (response.channels ?? [])
      .map(normalize_slack_channel)
      .filter((channel): channel is SlackChannelSummary => channel !== null),
    next_cursor: response.response_metadata?.next_cursor || null,
  };
}

export async function join_slack_channel(token: string, channel_id: string) {
  const response = await slack_call(() =>
    create_slack_web_client(token, onboarding_slack_client_options).conversations.join({
      channel: channel_id,
    }),
  );

  // `already_in_channel` is returned by Slack but absent from the SDK's response type, so read
  // it off the raw payload. A re-join is still a success for our purposes.
  return {
    channel_id,
    already_in_channel: has_slack_warning(response, 'already_in_channel'),
  };
}

export async function fetch_slack_channel_is_private(token: string, channel_id: string) {
  const client = create_slack_web_client(token, onboarding_slack_client_options);
  const response = await slack_call(() => client.conversations.info({ channel: channel_id }));
  return response.channel?.is_private === true;
}

export function read_slack_authed_user_id(connection: SlackCredentialConnection | null) {
  return connection?.provider_account?.authed_user?.id;
}

export async function resolve_slack_bot_user_id(token: string) {
  try {
    const response = await slack_call(() =>
      create_slack_web_client(token, onboarding_slack_client_options).auth.test(),
    );
    return response.user_id;
  } catch {
    return null;
  }
}

export async function lookup_slack_user_id_by_email(token: string, email: string) {
  try {
    const response = await create_slack_web_client(
      token,
      onboarding_slack_client_options,
    ).users.lookupByEmail({ email });
    return response.user?.id;
  } catch {
    return null;
  }
}

export async function lookup_slack_user_email(token: string, slack_user_id: string) {
  try {
    const response = await create_slack_web_client(
      token,
      onboarding_slack_client_options,
    ).users.info({ user: slack_user_id });
    return response.user?.profile?.email ?? null;
  } catch {
    return null;
  }
}

export async function open_slack_dm_channel(token: string, slack_user_id: string) {
  const response = await slack_call(() =>
    create_slack_web_client(token, onboarding_slack_client_options).conversations.open({
      users: slack_user_id,
    }),
  );
  return response.channel?.id;
}

export async function post_slack_message(
  token: string,
  channel: string,
  text: string,
  options: SlackMessageOptions = {},
) {
  const slack_client = create_slack_web_client(token, onboarding_slack_client_options);
  return post_slack_message_with_client(slack_client, channel, text, options);
}

export type SlackMessageOptions = {
  thread_ts?: string | null;
  idempotency_key?: string;
  reconcile_before_post?: boolean;
  blocks?: unknown[];
};

export async function post_slack_message_with_client(
  slack_client: WebClient,
  channel: string,
  text: string,
  options: SlackMessageOptions = {},
) {
  if (options.idempotency_key && options.reconcile_before_post === true) {
    const existing_message_ts = await find_idempotent_slack_message(
      slack_client,
      channel,
      options.idempotency_key,
      options.thread_ts,
    );
    if (existing_message_ts) return existing_message_ts;
  }

  const response = await slack_call(() =>
    slack_client.chat.postMessage({
      channel,
      text: slack_message_text_from_markdown(text),
      ...(options.blocks ? { blocks: options.blocks as KnownBlock[] } : {}),
      ...(options.thread_ts ? { thread_ts: options.thread_ts } : {}),
      ...(options.idempotency_key
        ? {
            metadata: {
              event_type: 'alfera_idempotent_message',
              event_payload: { idempotency_key: options.idempotency_key },
            },
          }
        : {}),
      unfurl_links: false,
      unfurl_media: false,
    }),
  );
  return response.ts;
}

async function find_idempotent_slack_message(
  slack_client: WebClient,
  channel: string,
  idempotency_key: string,
  thread_ts?: string | null,
) {
  let cursor: string | undefined;
  do {
    const response = await slack_call(() =>
      thread_ts
        ? slack_client.conversations.replies({
            channel,
            ts: thread_ts,
            include_all_metadata: true,
            limit: 100,
            ...(cursor === undefined ? {} : { cursor }),
          })
        : slack_client.conversations.history({
            channel,
            include_all_metadata: true,
            limit: 100,
            ...(cursor === undefined ? {} : { cursor }),
          }),
    );
    const existing_message = response.messages?.find((candidate) => {
      const metadata = candidate.metadata as SlackIdempotencyMetadata | undefined;
      return (
        metadata?.event_type === 'alfera_idempotent_message' &&
        metadata.event_payload?.idempotency_key === idempotency_key
      );
    });
    const existing_message_ts = existing_message?.ts;
    if (existing_message_ts) return existing_message_ts;
    cursor = response.response_metadata?.next_cursor;
  } while (cursor);

  return null;
}

export async function find_primary_member_channel(token: string) {
  const page = await fetch_public_slack_channels(token, { limit: 200 });
  return (
    page.channels
      .filter((channel) => channel.is_member)
      .sort((left, right) => (right.num_members ?? 0) - (left.num_members ?? 0))[0] ?? null
  );
}

function normalize_slack_channel(channel: SlackChannel): SlackChannelSummary | null {
  const { id, name } = channel;
  if (!id || !name) return null;

  return {
    id,
    name,
    is_private: channel.is_private === true,
    is_member: channel.is_member === true,
    num_members: channel.num_members ?? null,
  };
}

function has_slack_warning(response: WebAPICallResult & { warning?: string }, warning: string) {
  return (
    response.warning === warning || Boolean(response.response_metadata?.warnings?.includes(warning))
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
