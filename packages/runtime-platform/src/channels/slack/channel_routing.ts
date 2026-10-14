type SlackFilePayload = {
  id?: unknown;
  external_file_id?: unknown;
  name?: unknown;
  file_name?: unknown;
  mimetype?: unknown;
  mime_type?: unknown;
  size?: unknown;
  byte_size?: unknown;
  file_access?: unknown;
};

export type SlackChannelMessage = {
  team_id: string;
  channel_id: string;
  channel_type: 'im' | 'mpim' | 'channel' | 'group';
  event_ts: string;
  thread_ts?: string | null;
  user_id: string;
  user_profile?: SlackChannelUserProfile;
  text?: string;
  raw_text?: string;
  mentioned_bot_user_id?: string | null;
  files?: SlackChannelFile[];
};

export type SlackChannelFile = {
  external_file_id: string;
  file_name?: string;
  mime_type?: string;
  byte_size?: number;
  file_access?: string;
};

export function read_slack_channel_files(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    return normalize_slack_channel_file(candidate as SlackFilePayload);
  });
}

function normalize_slack_channel_file(file: SlackFilePayload): SlackChannelFile[] {
  const external_file_id =
    typeof file.id === 'string' && file.id
      ? file.id
      : typeof file.external_file_id === 'string' && file.external_file_id
        ? file.external_file_id
        : undefined;
  if (!external_file_id) return [];
  const file_name =
    typeof file.name === 'string' && file.name
      ? file.name
      : typeof file.file_name === 'string' && file.file_name
        ? file.file_name
        : undefined;
  const mime_type =
    typeof file.mimetype === 'string' && file.mimetype
      ? file.mimetype
      : typeof file.mime_type === 'string' && file.mime_type
        ? file.mime_type
        : undefined;
  const byte_size =
    typeof file.size === 'number' && Number.isFinite(file.size)
      ? file.size
      : typeof file.byte_size === 'number' && Number.isFinite(file.byte_size)
        ? file.byte_size
        : undefined;
  const file_access =
    typeof file.file_access === 'string' && file.file_access ? file.file_access : undefined;
  return [
    {
      external_file_id,
      ...(file_name ? { file_name: file_name.slice(0, 240) } : {}),
      ...(mime_type ? { mime_type: mime_type.slice(0, 120) } : {}),
      ...(byte_size !== undefined ? { byte_size } : {}),
      ...(file_access ? { file_access } : {}),
    },
  ];
}

export function deduplicate_slack_channel_files(files: SlackChannelFile[]) {
  return [...new Map(files.map((file) => [file.external_file_id, file])).values()];
}

export type SlackChannelUserProfile = {
  display_name?: string | null;
  real_name?: string | null;
  username?: string | null;
  email?: string | null;
  email_is_verified?: boolean;
  avatar_url?: string | null;
  timezone?: string | null;
  is_bot?: boolean;
  profile_source?: 'event_payload' | 'provider_profile' | 'manual';
  profile_synced_time?: string | null;
};

type SlackChannelConversationScope = 'dm' | 'group' | 'channel' | 'thread';

export type SlackChannelConversation = {
  scope: SlackChannelConversationScope;
  external_thread_key: string;
  thread_ts?: string;
};

export type SlackChannelPolicy = {
  allowed_channel_ids?: string[];
  denied_channel_ids?: string[];
  allowed_user_ids?: string[];
  require_bot_mention_in_channels?: boolean;
};

export type SlackChannelAuthorizationContext = {
  known_thread_reply?: boolean;
};

export type SlackChannelAuthorization =
  | { authorized: true }
  | {
      authorized: false;
      code: 'channel_denied' | 'channel_not_allowed' | 'user_not_allowed' | 'mention_required';
      message: string;
    };

export function resolve_slack_channel_conversation(
  target: SlackChannelMessage,
): SlackChannelConversation {
  const thread_ts = resolve_slack_thread_ts(target);
  if (thread_ts) {
    return {
      scope: 'thread',
      external_thread_key: `slack:${target.team_id}:${target.channel_id}:thread:${thread_ts}`,
      thread_ts,
    };
  }

  const scope = resolve_slack_channel_scope(target);
  return {
    scope,
    external_thread_key: `slack:${target.team_id}:${target.channel_id}:${scope}`,
  };
}

export function build_slack_external_conversation_key(target: SlackChannelMessage) {
  return resolve_slack_channel_conversation(target).external_thread_key;
}

export function resolve_slack_thread_ts(target: SlackChannelMessage) {
  const thread_ts = target.thread_ts?.trim();
  if (thread_ts) return thread_ts;
  if (is_public_or_private_channel(target)) return target.event_ts;
  return undefined;
}

export function authorize_slack_channel_message(
  target: SlackChannelMessage,
  policy: SlackChannelPolicy = {},
  context: SlackChannelAuthorizationContext = {},
): SlackChannelAuthorization {
  if (policy.denied_channel_ids?.includes(target.channel_id)) {
    return {
      authorized: false,
      code: 'channel_denied',
      message: 'Slack channel is denied for this agent.',
    };
  }

  if (policy.allowed_channel_ids && !policy.allowed_channel_ids.includes(target.channel_id)) {
    return {
      authorized: false,
      code: 'channel_not_allowed',
      message: 'Slack channel is not allowed for this agent.',
    };
  }

  if (policy.allowed_user_ids && !policy.allowed_user_ids.includes(target.user_id)) {
    return {
      authorized: false,
      code: 'user_not_allowed',
      message: 'Slack user is not allowed to message this agent.',
    };
  }

  if (
    policy.require_bot_mention_in_channels &&
    is_public_or_private_channel(target) &&
    !target.mentioned_bot_user_id &&
    !can_continue_known_thread(target, context)
  ) {
    return {
      authorized: false,
      code: 'mention_required',
      message: 'Slack channel messages must mention the bot.',
    };
  }

  return { authorized: true };
}

export function is_slack_thread_reply(target: SlackChannelMessage) {
  const thread_ts = target.thread_ts?.trim();
  return Boolean(thread_ts && thread_ts !== target.event_ts);
}

export function normalize_slack_message_text(text: string, bot_user_id?: string | null) {
  if (!bot_user_id) return text.trim();
  return text
    .replace(new RegExp(`<@${escape_regexp(bot_user_id)}(?:\\|[^>]+)?>`, 'g'), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function is_public_or_private_channel(target: SlackChannelMessage) {
  return target.channel_type === 'channel' || target.channel_type === 'group';
}

function can_continue_known_thread(
  target: SlackChannelMessage,
  context: SlackChannelAuthorizationContext,
) {
  return context.known_thread_reply === true && is_slack_thread_reply(target);
}

function resolve_slack_channel_scope(
  target: SlackChannelMessage,
): Exclude<SlackChannelConversationScope, 'thread'> {
  if (target.channel_type === 'im') return 'dm';
  if (target.channel_type === 'mpim') return 'group';
  return 'channel';
}

function escape_regexp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
