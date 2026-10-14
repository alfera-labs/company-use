import { env } from '@coworker/config';
import { read_timezone_from_user_data } from '@coworker/core/db/queries/user_timezone';
import type { SessionCurrentTurnContext } from '@runtime-platform/orchestrator/context_builder';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';
import type { RuntimeToolSourceMetadata } from '@runtime-platform/tools/types';

type CurrentTurnInput = Pick<
  StartAgentRunInput,
  'session_id' | 'source_type' | 'user_message_source_metadata' | 'read_actor_user'
>;

export function build_model_visible_current_turn_context(
  input: CurrentTurnInput,
  speaker?: { name: string; email?: string },
): SessionCurrentTurnContext | undefined {
  const source_context = build_current_turn_source_context(input, speaker);
  if (!source_context) return undefined;
  return { ...source_context, chat_url: chat_page_url(input.session_id) };
}

function chat_page_url(session_id: string) {
  return new URL(`/chats/${session_id}`, env.NEXT_PUBLIC_APP_URL).toString();
}

function build_current_turn_source_context(
  input: CurrentTurnInput,
  speaker?: { name: string; email?: string },
): SessionCurrentTurnContext | undefined {
  if (input.source_type === 'slack') return build_slack_current_turn_context(input);
  if (input.source_type === 'email') return build_email_current_turn_context(input);
  if (input.source_type === 'api') return build_api_current_turn_context(input);
  if (input.source_type === undefined || input.source_type === 'dashboard') {
    const sender = get_source_actor_identity(input.user_message_source_metadata);
    const speaker_name = sender?.name ?? speaker?.name;
    const speaker_email = sender?.email ?? speaker?.email;
    const stored_timezone = input.read_actor_user
      ? read_timezone_from_user_data(input.read_actor_user.user_data)
      : null;
    return {
      source_type: 'web_chat',
      web_chat: {
        ...(speaker_name ? { speaker_name } : {}),
        ...(speaker_email ? { speaker_email } : {}),
        ...local_time_of_speaker(stored_timezone),
      },
    };
  }
  const timezone = input.user_message_source_metadata?.local_timezone;
  const local_time = timezone ? format_speaker_local_time(new Date(), timezone) : null;
  return { source_type: 'headless', headless: local_time ? { local_time } : {} };
}

function build_email_current_turn_context(
  input: CurrentTurnInput,
): SessionCurrentTurnContext | undefined {
  const email = input.user_message_source_metadata?.email;
  if (!email) return undefined;

  const sender_identity = get_source_actor_identity(input.user_message_source_metadata);
  const sender = email.from ?? sender_identity?.email;
  const reply_recipients = email.reply_to_email
    ? [email.reply_to_email, ...(email.reply_cc ?? [])]
    : [];
  return {
    source_type: 'email',
    email: {
      ...(email.workspace_address ? { workspace_address: email.workspace_address } : {}),
      ...(sender ? { sender } : {}),
      ...(typeof email.sender_is_workspace_member === 'boolean'
        ? { sender_is_workspace_member: email.sender_is_workspace_member }
        : {}),
      ...(typeof email.reply_expected === 'boolean'
        ? { reply_expected: email.reply_expected }
        : {}),
      ...(email.subject ? { subject: email.subject } : {}),
      ...(reply_recipients.length ? { reply_recipients } : {}),
    },
  };
}

function build_api_current_turn_context(input: CurrentTurnInput): SessionCurrentTurnContext {
  const sender = get_source_actor_identity(input.user_message_source_metadata);
  return { source_type: 'api', api: { ...(sender?.name ? { speaker_name: sender.name } : {}) } };
}

function build_slack_current_turn_context(
  input: CurrentTurnInput,
): SessionCurrentTurnContext | undefined {
  const slack = input.user_message_source_metadata?.slack;
  if (!slack) return undefined;

  const {
    channel_id,
    thread_ts,
    event_ts,
    team_id,
    channel_type,
    configured_channel_id,
    conversation_scope,
    addressing_mode,
  } = slack;
  if (!channel_id && !thread_ts && !event_ts) return undefined;

  const sender = get_source_actor_identity(input.user_message_source_metadata);
  return {
    source_type: 'slack',
    slack: {
      ...(team_id ? { team_id } : {}),
      ...(channel_id ? { channel_id } : {}),
      ...(channel_type ? { channel_type } : {}),
      ...(configured_channel_id ? { configured_channel_id } : {}),
      ...(conversation_scope ? { conversation_scope } : {}),
      ...(addressing_mode ? { addressing_mode } : {}),
      ...(event_ts ? { event_ts } : {}),
      ...(thread_ts ? { thread_ts } : {}),
      ...(sender?.user_id ? { speaker_user_id: sender.user_id } : {}),
      ...(sender?.name ? { speaker_name: sender.name } : {}),
      ...(sender?.email ? { speaker_email: sender.email } : {}),
      ...local_time_of_speaker(sender?.timezone),
    },
  };
}

export function get_source_actor_identity(source_metadata?: RuntimeToolSourceMetadata) {
  const actor = source_metadata?.source_actor;
  if (!actor) return null;
  const profile = actor.profile;
  const user_id = actor.external_user_id ?? actor.external_ids[0]?.external_user_id;
  return {
    user_id,
    name: profile.real_name ?? profile.display_name ?? undefined,
    email: profile.email ?? undefined,
    timezone: profile.timezone ?? undefined,
  };
}

function local_time_of_speaker(timezone: string | null | undefined) {
  const speaker_local_time = timezone ? format_speaker_local_time(new Date(), timezone) : null;
  return speaker_local_time ? { speaker_local_time } : {};
}

function format_speaker_local_time(now: Date, timezone: string) {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    return `${formatted} (${timezone})`;
  } catch {
    return null;
  }
}
