import type { Database } from '@coworker/core';
import { revoke_connection } from '@coworker/core/db/queries/connection_management';
import type { EnqueueEventInput } from '@coworker/core/db/queries/events';
import { events } from '@coworker/core/db/schema';
import type {
  EventRawPayloadData,
  ProviderAccountData,
  SlackRawEventData,
} from '@coworker/core/db/schema/json_column_types';
import { event_job_queue_barrier_metadata_key } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';
import {
  find_active_slack_connection,
  type SlackEventConnection,
} from '@runtime-platform/channels/slack/channel_event_dispatch';
import {
  add_slack_processing_reaction,
  type SlackReactionOptions,
} from '@runtime-platform/channels/slack/channel_reactions';
import {
  is_slack_thread_reply,
  normalize_slack_message_text,
  read_slack_channel_files,
  type SlackChannelFile,
  type SlackChannelMessage,
} from '@runtime-platform/channels/slack/channel_routing';
import type {
  SlackEventBody,
  SlackMessageEvent,
} from '@runtime-platform/channels/slack/slack_event_payload';
import { fire_slack_message_ears } from '@runtime-platform/channels/slack/slack_message_ears';
import { build_slack_turn_queue_key } from '@runtime-platform/channels/slack/turn_subject';
import { and, eq } from 'drizzle-orm';

const log = create_logger('slack_channel_event_queue');
const slack_agent_message_handler = 'slack_agent_message';
const slack_message_debounce_ms = 2_000;

export async function prepare_slack_channel_event_jobs(
  db: Database,
  event: VerifiedChannelEvent,
  options: SlackReactionOptions = {},
): Promise<EnqueueEventInput | null> {
  if (!can_query_database(db)) {
    log_slack_event_queue_drop(event, 'database_unavailable');
    return null;
  }

  const body = event.raw_event as SlackEventBody;
  const team_id = read_slack_team_id(body);
  const slack_event = body.event;
  if (!team_id || !slack_event) {
    log_slack_event_queue_drop(event, 'payload_missing_team_or_event', {
      team_id: team_id ?? undefined,
      api_app_id: body.api_app_id,
    });
    return null;
  }

  const connection = await find_active_slack_connection(db, {
    team_id,
    ...(body.api_app_id === undefined ? {} : { api_app_id: body.api_app_id }),
  });
  if (!connection) {
    log_slack_event_queue_drop(event, 'active_connection_missing', {
      team_id,
      api_app_id: body.api_app_id,
      slack_event_type: slack_event.type,
      channel_id: slack_event.channel,
      user_id: slack_event.user,
    });
    return null;
  }

  const release_reason = read_slack_claim_release_reason(slack_event);
  if (release_reason) {
    await revoke_connection(db, {
      workspace_id: connection.workspace_id,
      connection_id: connection.connection_id,
      actor_id: connection.connected_by ?? connection.last_updated_by,
    });
    log_slack_event_queue_drop(event, release_reason, {
      workspace_id: connection.workspace_id,
      team_id,
      api_app_id: body.api_app_id,
      connection_id: connection.connection_id,
    });
    return ignored_slack_event(event, body, team_id, connection.workspace_id, {
      reason: release_reason,
    });
  }

  const skipped_message = read_slack_message_skip_reason(connection, slack_event);
  const message = build_queued_slack_message(connection, team_id, slack_event);
  if (message && slack_message_reaches_automations(skipped_message)) {
    await fire_slack_message_ears_quietly(db, connection.workspace_id, message);
  }
  if (skipped_message) {
    log_slack_event_queue_drop(event, skipped_message.reason, {
      workspace_id: connection.workspace_id,
      team_id,
      api_app_id: body.api_app_id,
      slack_event_type: slack_event.type,
      channel_id: slack_event.channel,
      user_id: slack_event.user,
      ...skipped_message,
    });
    return ignored_slack_event(event, body, team_id, connection.workspace_id, skipped_message);
  }

  if (
    message &&
    should_add_immediate_processing_reaction(message) &&
    !(await slack_message_event_exists(db, connection.workspace_id, message))
  ) {
    void add_slack_processing_reaction(connection, message, options).catch((error) =>
      log.warn('slack processing reaction failed', {
        workspace_id: connection.workspace_id,
        error: format_error_message(error),
      }),
    );
  }
  if (message) return routed_slack_event(event, body, message, connection.workspace_id);

  log_slack_event_queue_drop(event, 'message_fields_missing', {
    workspace_id: connection.workspace_id,
    team_id,
    api_app_id: body.api_app_id,
    slack_event_type: slack_event.type,
    channel_id: slack_event.channel,
    user_id: slack_event.user,
  });
  return ignored_slack_event(event, body, team_id, connection.workspace_id, {
    reason: 'message_fields_missing',
  });
}

function slack_message_reaches_automations(skipped_message: { reason: string } | null) {
  return !skipped_message || skipped_message.reason === 'top_level_mention_required';
}

async function fire_slack_message_ears_quietly(
  db: Database,
  workspace_id: string,
  message: SlackChannelMessage,
) {
  try {
    await fire_slack_message_ears(db, { workspace_id, message });
  } catch (error) {
    log.error('Slack automation ears could not be fired', {
      workspace_id,
      channel_id: message.channel_id,
      event_ts: message.event_ts,
      error: format_error_message(error),
    });
  }
}

function should_add_immediate_processing_reaction(message: SlackChannelMessage) {
  return !is_slack_thread_reply(message) || Boolean(message.mentioned_bot_user_id);
}

function debounce_ms_for(message: SlackChannelMessage) {
  const addressed_to_agent =
    message.channel_type === 'im' || Boolean(message.mentioned_bot_user_id);
  return addressed_to_agent ? 0 : slack_message_debounce_ms;
}

function routed_slack_event(
  event: VerifiedChannelEvent,
  body: SlackEventBody,
  message: SlackChannelMessage,
  workspace_id: string,
): EnqueueEventInput {
  const queue_key = build_slack_turn_queue_key(message);
  return {
    workspace_id,
    source: 'slack',
    source_event_id: build_slack_source_event_id(message),
    event_type: event.provider_event_type ?? 'message',
    queue_key,
    actor_key: `slack_user:${message.user_id}`,
    event_body: build_slack_event_body(body, message),
    raw_payload: build_persistable_slack_payload(event.raw_event),
    event_status: 'routed',
    event_jobs: [
      {
        job_handler: slack_agent_message_handler,
        available_time: new Date(Date.now() + debounce_ms_for(message)),
        metadata: { [event_job_queue_barrier_metadata_key]: true },
      },
    ],
  };
}

function ignored_slack_event(
  event: VerifiedChannelEvent,
  body: SlackEventBody,
  team_id: string,
  workspace_id: string,
  skipped_message: { reason: string; [key: string]: unknown },
): EnqueueEventInput {
  return {
    workspace_id,
    source: 'slack',
    source_event_id: event.provider_event_id,
    event_type: event.provider_event_type ?? 'unsupported',
    queue_key: `slack:${team_id}:ignored:${event.provider_event_id}`,
    actor_key: `slack:${team_id}:unknown`,
    event_body: {
      team_id,
      api_app_id: body.api_app_id,
      ignored_reason: skipped_message.reason,
    },
    raw_payload: build_persistable_slack_payload(event.raw_event),
    event_status: 'ignored',
    metadata: { ignored_reason: skipped_message.reason },
    event_jobs: [],
  };
}

function build_queued_slack_message(
  connection: SlackEventConnection,
  team_id: string,
  event: SlackMessageEvent,
): SlackChannelMessage | null {
  const channel_id = event.channel;
  const user_id = event.user;
  const event_ts = event.ts ?? event.event_ts;
  if (!channel_id || !user_id || !event_ts) return null;

  const bot_user_id = read_bot_user_id(connection.provider_account);
  const raw_text = event.text ?? '';
  return {
    team_id,
    channel_id,
    channel_type: read_slack_channel_type(event, channel_id),
    event_ts,
    ...(typeof event.thread_ts === 'string' ? { thread_ts: event.thread_ts } : {}),
    user_id,
    text: normalize_slack_message_text(raw_text, bot_user_id),
    raw_text,
    mentioned_bot_user_id: read_mentioned_bot_user_id(event, bot_user_id),
    files: read_slack_channel_files(event.files),
  };
}

function build_slack_event_body(body: SlackEventBody, message: SlackChannelMessage) {
  return {
    team_id: message.team_id,
    api_app_id: body.api_app_id,
    channel_id: message.channel_id,
    channel_type: message.channel_type,
    event_ts: message.event_ts,
    ...(message.thread_ts ? { thread_ts: message.thread_ts } : {}),
    user_id: message.user_id,
    text: message.text ?? '',
    raw_text: message.raw_text ?? '',
    mentioned_bot_user_id: message.mentioned_bot_user_id ?? undefined,
    files: message.files ?? [],
  };
}

function build_persistable_slack_payload(raw_payload: EventRawPayloadData): EventRawPayloadData {
  const body = remove_private_slack_file_urls(raw_payload) as SlackEventBody;
  const { team_id, event, ...payload_fields } = body;

  return {
    ...payload_fields,
    ...(team_id === undefined ? {} : { team_id }),
    ...(event === undefined ? {} : { event: build_persistable_slack_event(event) }),
  };
}

function build_persistable_slack_event(event: SlackMessageEvent): SlackRawEventData {
  const { channel, ts, event_ts, thread_ts, user, text, files, ...event_fields } = event;
  const persisted_files = Array.isArray(files)
    ? read_slack_channel_files(files).map(slack_file_for_persistence)
    : files;

  return {
    ...event_fields,
    ...(channel === undefined ? {} : { channel }),
    ...(ts === undefined ? {} : { ts }),
    ...(event_ts === undefined ? {} : { event_ts }),
    ...(thread_ts === undefined ? {} : { thread_ts }),
    ...(user === undefined ? {} : { user }),
    ...(text === undefined ? {} : { text }),
    ...(persisted_files === undefined ? {} : { files: persisted_files }),
  };
}

// Slack can nest file objects inside edited or deleted messages, so every object is inspected.
function remove_private_slack_file_urls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(remove_private_slack_file_urls);

  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(record).flatMap(([key, nested_value]) =>
      key === 'url_private' || key === 'url_private_download'
        ? []
        : [[key, remove_private_slack_file_urls(nested_value)]],
    ),
  );
}

function slack_file_for_persistence(file: SlackChannelFile) {
  return {
    id: file.external_file_id,
    ...(file.file_name ? { name: file.file_name } : {}),
    ...(file.mime_type ? { mimetype: file.mime_type } : {}),
    ...(file.byte_size !== undefined ? { size: file.byte_size } : {}),
    ...(file.file_access ? { file_access: file.file_access } : {}),
  };
}

function build_slack_source_event_id(message: SlackChannelMessage) {
  const root_ts = message.thread_ts ?? message.event_ts;
  return `message:${message.team_id}:${message.channel_id}:${root_ts}:${message.event_ts}`;
}

async function slack_message_event_exists(
  db: Database,
  workspace_id: string,
  message: SlackChannelMessage,
) {
  const event = await db.query.events.findFirst({
    where: and(
      eq(events.workspace_id, workspace_id),
      eq(events.source, 'slack'),
      eq(events.source_event_id, build_slack_source_event_id(message)),
    ),
  });
  return Boolean(event);
}

function read_slack_message_skip_reason(
  connection: SlackEventConnection,
  event: SlackMessageEvent,
) {
  const type = event.type;
  if (type !== 'app_mention' && type !== 'message') {
    return { reason: 'unsupported_event_type', slack_event_type: type };
  }

  // A message with an uploaded file arrives as subtype 'file_share'. It is still a real human
  // message (text + attachment) — dropping it made the bot ignore anyone posting a screenshot.
  const subtype = event.subtype;
  if (subtype && subtype !== 'file_share') return { reason: 'message_subtype_ignored', subtype };

  const bot_id = event.bot_id;
  if (bot_id) return { reason: 'bot_message_ignored', bot_id };

  const bot_user_id = read_bot_user_id(connection.provider_account);
  if (bot_user_id && event.user === bot_user_id) {
    return { reason: 'self_message_ignored', bot_user_id };
  }

  const addressed_message_skip_reason = read_unaddressed_channel_message_skip_reason(
    event,
    bot_user_id,
  );
  if (addressed_message_skip_reason) return addressed_message_skip_reason;

  return null;
}

function read_unaddressed_channel_message_skip_reason(
  event: SlackMessageEvent,
  bot_user_id: string | null,
) {
  const channel_id = event.channel;
  const event_ts = event.ts ?? event.event_ts;
  const thread_ts = event.thread_ts;
  if (!channel_id || !event_ts) return null;

  const channel_type = read_slack_channel_type(event, channel_id);
  if (channel_type !== 'channel' && channel_type !== 'group') return null;
  if (thread_ts && thread_ts !== event_ts) return null;
  if (event.type === 'app_mention') return null;
  if (read_mentioned_bot_user_id(event, bot_user_id)) return null;

  return { reason: 'top_level_mention_required' };
}

function read_slack_channel_type(
  event: SlackMessageEvent,
  channel_id: string,
): SlackChannelMessage['channel_type'] {
  const channel_type = event.channel_type;
  if (channel_type === 'im' || channel_type === 'mpim') return channel_type;
  if (channel_type === 'channel' || channel_type === 'group') return channel_type;
  if (channel_id.startsWith('D')) return 'im';
  if (channel_id.startsWith('G')) return 'group';
  return 'channel';
}

function read_mentioned_bot_user_id(event: SlackMessageEvent, bot_user_id: string | null) {
  if (!bot_user_id) return null;
  if (event.type === 'app_mention') return bot_user_id;
  const text = event.text;
  return text?.includes(`<@${bot_user_id}>`) ? bot_user_id : null;
}

// Slack event types that prove the bot can no longer act on the team, so its connection
// claim should be released. `app_uninstalled_team` covers the Enterprise Grid variant.
function read_slack_claim_release_reason(slack_event: SlackMessageEvent) {
  const type = slack_event.type;
  if (type === 'app_uninstalled' || type === 'app_uninstalled_team') return 'app_uninstalled';
  if (type === 'tokens_revoked') return 'tokens_revoked';
  return null;
}

function read_slack_team_id(body: SlackEventBody) {
  return body.team_id ?? body.event?.team ?? read_first_authorization(body.authorizations)?.team_id;
}

function read_first_authorization(authorizations: SlackEventBody['authorizations']) {
  return authorizations?.[0];
}

function read_bot_user_id(provider_account: ProviderAccountData | null | undefined) {
  return provider_account?.bot_user_id ?? provider_account?.botUserId ?? null;
}

function can_query_database(db: Database) {
  return typeof (db as { query?: unknown }).query === 'object';
}

function log_slack_event_queue_drop(
  event: VerifiedChannelEvent,
  reason: string,
  details: Record<string, unknown> = {},
) {
  const payload = {
    reason,
    provider_event_id: event.provider_event_id,
    external_account_id: event.external_account_id,
    provider_event_type: event.provider_event_type,
    ...details,
  };
  if (is_slack_event_queue_error(reason)) {
    log.error('Slack event was not queued', payload);
    return;
  }

  log.warn('Slack event was not queued', payload);
}

function is_slack_event_queue_error(reason: string) {
  return (
    reason === 'database_unavailable' ||
    reason === 'payload_missing_team_or_event' ||
    reason === 'active_connection_missing' ||
    reason === 'message_fields_missing'
  );
}
