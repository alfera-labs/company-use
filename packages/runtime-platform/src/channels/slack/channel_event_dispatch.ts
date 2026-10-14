import { connections, type Database } from '@coworker/core';
import type {
  ConnectionConfigData,
  ConnectionCredentialData,
  ProviderAccountData,
} from '@coworker/core/db/schema/json_column_types';
import { create_logger } from '@coworker/shared';
import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';
import { create_slack_attachment_sources } from '@runtime-platform/channels/slack/attachment_sources';
import {
  deduplicate_slack_channel_files,
  normalize_slack_message_text,
  read_slack_channel_files,
  resolve_slack_channel_conversation,
  type SlackChannelFile,
  type SlackChannelMessage,
} from '@runtime-platform/channels/slack/channel_routing';
import {
  find_slack_channel_agent_for_event,
  type SlackConnectionForChannelSetup,
} from '@runtime-platform/channels/slack/channel_setup';
import {
  type StartSlackChannelTurnInput,
  start_slack_channel_turn,
} from '@runtime-platform/channels/slack/channel_turn';
import {
  read_slack_bot_token,
  read_slack_user_profile,
} from '@runtime-platform/channels/slack/read_slack_user_profile';
import type {
  SlackEventBody,
  SlackMessageEvent,
} from '@runtime-platform/channels/slack/slack_event_payload';
import type { SlackTurnFinalizeResult } from '@runtime-platform/channels/slack/turn_finalize';
import type { AgentRunJob } from '@runtime-platform/orchestrator/agent_run_job';
import type { StartAgentRunPriorMessage } from '@runtime-platform/orchestrator/runtime_orchestrator';
import {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import { and, eq } from 'drizzle-orm';

const log = create_logger('slack_channel_event_dispatch');

export type SlackEventConnection = SlackConnectionForChannelSetup & {
  connection_status: string;
  credentials?: ConnectionCredentialData | null;
  connection_config?: ConnectionConfigData | null;
  provider_account?: ProviderAccountData | null;
  connected_by?: string | null;
  last_updated_by: string;
};

export type SlackChannelEventDispatchResult =
  | {
      dispatched: true;
      workspace_id: string;
      connection_id: string;
      agent_id: string;
      channel_id: string | null;
      session_id: string;
      run_id: string;
      turn_finalize: SlackTurnFinalizeResult;
    }
  | {
      dispatched: false;
      code:
        | 'database_unavailable'
        | 'unsupported_event'
        | 'connection_missing'
        | 'channel_missing'
        | 'target_unsupported'
        | 'turn_rejected'
        | 'turn_not_authorized'
        | 'out_of_credits';
      message: string;
    };

const slack_turn_policy_denial_codes = new Set([
  'mention_required',
  'channel_denied',
  'channel_not_allowed',
  'user_not_allowed',
  'message_not_for_agent',
]);

function dispatch_code_for_unaccepted_turn(
  code: string,
): 'out_of_credits' | 'turn_not_authorized' | 'turn_rejected' {
  if (code === 'out_of_credits') return 'out_of_credits';
  if (slack_turn_policy_denial_codes.has(code)) return 'turn_not_authorized';
  return 'turn_rejected';
}

export async function dispatch_slack_channel_event(
  db: Database,
  event: VerifiedChannelEvent,
  options: {
    run_options?: StartSlackChannelTurnInput['run_options'];
    prior_messages?: StartAgentRunPriorMessage[];
    known_thread_reply?: boolean;
    files?: SlackChannelFile[];
    job?: AgentRunJob;
  } = {},
): Promise<SlackChannelEventDispatchResult> {
  if (!can_query_database(db)) {
    return {
      dispatched: false,
      code: 'database_unavailable',
      message: 'Slack event dispatch requires a queryable database.',
    };
  }

  const body = event.raw_event as SlackEventBody;
  const team_id = read_slack_team_id(body);
  const api_app_id = body.api_app_id;
  const slack_event = body.event;
  if (!team_id || !slack_event) {
    return unsupported_event('Slack event callback is missing a team id or event payload.');
  }

  const connection = await find_active_slack_connection(db, {
    team_id,
    ...(api_app_id === undefined ? {} : { api_app_id }),
  });
  if (!connection) {
    return {
      dispatched: false,
      code: 'connection_missing',
      message: `No active Slack connection found for team ${team_id}.`,
    };
  }

  const message = await build_slack_channel_message(connection, team_id, slack_event);
  if (!message) return unsupported_event('Slack event is not a supported user message.');
  message.files = deduplicate_slack_channel_files([
    ...(message.files ?? []),
    ...(options.files ?? []),
  ]);

  const conversation = resolve_slack_channel_conversation(message);
  const target = await find_slack_channel_agent_for_event(db, {
    workspace_id: connection.workspace_id,
    connection_id: connection.connection_id,
    external_account_id: team_id,
    external_conversation_id: message.channel_id,
    conversation_scope: conversation.scope,
    ...(conversation.thread_ts ? { external_thread_id: conversation.thread_ts } : {}),
  });
  if (!target) {
    return {
      dispatched: false,
      code: 'channel_missing',
      message: `No enabled Slack channel route found for ${team_id}/${message.channel_id}.`,
    };
  }
  const attachment_sources = await create_slack_attachment_sources(
    read_slack_bot_token(connection) ?? '',
    team_id,
    message.files,
  );
  const original_files = message.files ?? [];
  message.files = attachment_sources.map((source, index) => {
    const original_file = original_files[index];
    if (!original_file) throw new Error('Slack attachment source lost its file descriptor');
    return {
      ...original_file,
      file_name: source.file_name,
      mime_type: source.mime_type,
      byte_size: source.byte_size,
    };
  });

  const result = await start_slack_channel_turn(db, {
    workspace_id: connection.workspace_id,
    agent_id: target.agent.agent_id,
    actor_id: connection.connected_by ?? connection.last_updated_by,
    connection_id: connection.connection_id,
    message,
    channel_project_id: target.channel.project_id,
    attachment_sources,
    ...(options.known_thread_reply === undefined
      ? {}
      : { known_thread_reply: options.known_thread_reply }),
    ...(options.prior_messages ? { prior_messages: options.prior_messages } : {}),
    ...(options.run_options ? { run_options: options.run_options } : {}),
    ...(options.job ? { job: options.job } : {}),
  });
  if (!result.accepted) {
    return {
      dispatched: false,
      code: dispatch_code_for_unaccepted_turn(result.code),
      message: result.message,
    };
  }

  return {
    dispatched: true,
    workspace_id: connection.workspace_id,
    connection_id: connection.connection_id,
    agent_id: target.agent.agent_id,
    channel_id: target.channel.channel_id,
    session_id: result.session_id,
    run_id: result.run_id,
    turn_finalize: result.turn_finalize,
  };
}

export async function build_slack_channel_message(
  connection: SlackEventConnection,
  team_id: string,
  event: SlackMessageEvent,
): Promise<SlackChannelMessage | null> {
  if (should_ignore_slack_event(connection, event)) return null;

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
    ...(await read_slack_user_profile(connection, user_id)),
    text: normalize_slack_message_text(raw_text, bot_user_id),
    raw_text,
    mentioned_bot_user_id: read_mentioned_bot_user_id(event, bot_user_id),
    files: read_slack_channel_files(event.files),
  };
}

function should_ignore_slack_event(connection: SlackEventConnection, event: SlackMessageEvent) {
  const type = event.type;
  if (type !== 'app_mention' && type !== 'message') return true;
  // A message with an uploaded file arrives as subtype 'file_share'. It is still a real human
  // message (text + attachment) — dropping it made the bot ignore anyone posting a screenshot.
  const subtype = event.subtype;
  if (subtype && subtype !== 'file_share') return true;
  if (event.bot_id) return true;

  const bot_user_id = read_bot_user_id(connection.provider_account);
  return Boolean(bot_user_id && event.user === bot_user_id);
}

export async function find_active_slack_connection(
  db: Database,
  input: { team_id: string; api_app_id?: string | null },
) {
  const rows = await db.query.connections.findMany({
    where: and(
      eq(connections.provider_key, native_slack_provider_key),
      eq(connections.provider_config_key, native_slack_provider_config_key),
      eq(connections.connection_profile_key, native_slack_connection_profile_key),
      eq(connections.connection_status, 'active'),
      eq(connections.external_account_id, input.team_id),
    ),
    orderBy: (table, { desc }) => [
      desc(table.connected_time),
      desc(table.last_updated_time),
      desc(table.created_time),
    ],
  });
  return select_slack_connection_for_event(rows as SlackEventConnection[], input.api_app_id);
}

function select_slack_connection_for_event(
  rows: SlackEventConnection[],
  api_app_id?: string | null,
) {
  if (rows.length <= 1) return rows[0] ?? null;

  const exact_match = api_app_id
    ? rows.find(
        (connection) => read_slack_connection_app_id(connection.provider_account) === api_app_id,
      )
    : undefined;
  if (exact_match) return exact_match;

  log.warn('multiple active Slack connections for one team; refusing to guess an owner', {
    api_app_id: api_app_id ?? null,
    connection_ids: rows.map((row) => row.connection_id),
    workspace_ids: rows.map((row) => row.workspace_id),
  });
  return null;
}

function read_slack_team_id(body: SlackEventBody) {
  return body.team_id ?? body.event?.team ?? read_first_authorization(body.authorizations)?.team_id;
}

function read_first_authorization(authorizations: SlackEventBody['authorizations']) {
  return authorizations?.[0];
}

function read_slack_channel_type(
  event: SlackMessageEvent,
  channel_id: string,
): SlackChannelMessage['channel_type'] {
  const channel_type = event.channel_type;
  if (
    channel_type === 'im' ||
    channel_type === 'mpim' ||
    channel_type === 'channel' ||
    channel_type === 'group'
  ) {
    return channel_type;
  }

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

function read_bot_user_id(provider_account: ProviderAccountData | null | undefined) {
  return provider_account?.bot_user_id ?? provider_account?.botUserId ?? null;
}

function read_slack_connection_app_id(provider_account: ProviderAccountData | null | undefined) {
  return (
    provider_account?.app_id ?? provider_account?.api_app_id ?? provider_account?.appId ?? null
  );
}

function unsupported_event(message: string): SlackChannelEventDispatchResult {
  return {
    dispatched: false,
    code: 'unsupported_event',
    message,
  };
}

function can_query_database(db: Database) {
  return typeof (db as { query?: unknown }).query === 'object';
}
