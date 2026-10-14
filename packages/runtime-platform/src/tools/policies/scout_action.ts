import { type Database, events } from '@coworker/core';
import {
  create_logger,
  format_error_message,
  type RuntimeToolResult,
  scout_actor,
  scout_config_key,
} from '@coworker/shared';
import {
  fetch_slack_thread_replies_page,
  read_slack_bot_token,
} from '@runtime-platform/channels/slack/history';
import { find_active_slack_connection_for_workspace_team } from '@runtime-platform/channels/slack/workspace_connection';
import {
  get_scout_source_metadata,
  type ScoutSourceMetadata,
} from '@runtime-platform/tools/policies/scout_source_metadata';
import type {
  RuntimeCatalogToolInput,
  RuntimeToolSourceContext,
} from '@runtime-platform/tools/types';
import { and, eq, ne, sql } from 'drizzle-orm';

const scheduled_task_actor = 'system:trigger';
const log = create_logger('scout_action_policy');

type ScoutAction =
  | { action_type: 'create_scheduled_task' }
  | {
      action_type: 'deliver_to_slack';
      channel_id: string | null;
      thread_ts: string | null;
    };

type ScoutSourceMessage = {
  event_id: string;
  queue_key: string;
  team_id: string;
  channel_id: string;
  message_ts: string;
  sender_user_id: string;
  mentioned_user_ids: string[];
};

const catalog_action_builders: Record<
  string,
  (tool_input: RuntimeCatalogToolInput) => ScoutAction
> = {
  'slack-send_message-1': build_slack_delivery_action,
  'slack-upload_file-1': build_slack_delivery_action,
};

export async function find_scout_catalog_action_error(input: {
  db: Database;
  workspace_id: string;
  actor_id: string;
  node_key: string;
  tool_input: RuntimeCatalogToolInput;
  source_context: RuntimeToolSourceContext | undefined;
}): Promise<RuntimeToolResult | null> {
  const build_action = catalog_action_builders[input.node_key];
  if (!build_action) return null;
  return find_scout_action_error({
    ...input,
    source_event_id: input.tool_input.source_event_id,
    action: build_action(input.tool_input),
  });
}

export async function find_scout_action_error(input: {
  db: Database;
  workspace_id: string;
  actor_id: string;
  source_event_id: string | undefined;
  source_context: RuntimeToolSourceContext | undefined;
  action: ScoutAction;
}): Promise<RuntimeToolResult | null> {
  const source_metadata = get_scout_source_metadata(input.source_context?.source_metadata);
  if (!is_scout_action(input.actor_id, source_metadata)) return null;
  if (input.actor_id === scout_actor && input.action.action_type === 'deliver_to_slack') {
    return blocked(
      'scout_cannot_message_people',
      'The scout never messages anyone. Call notifications-write_notification-1 instead: the notification rules decides whether it reaches a person.',
    );
  }
  const source_event_id = input.source_event_id;
  if (!source_event_id) {
    return blocked('scout_source_required', 'Scout actions require source_event_id.');
  }
  const reference_error = find_source_reference_error(source_event_id, source_metadata);
  if (reference_error) return reference_error;

  const source = await find_source_message(input.db, input.workspace_id, source_event_id);
  if (!source) {
    return blocked('scout_source_invalid', 'The scout source is not a Slack message.');
  }
  if (!action_targets_source(input.action, source)) {
    return blocked(
      'scout_destination_rejected',
      'Scout Slack delivery must use the source thread, requester DM, or mentioned-user DM.',
    );
  }
  if (await source_has_persisted_reply(input.db, input.workspace_id, source)) {
    return blocked('scout_source_answered', 'Someone already replied in this Slack thread.');
  }

  const live_state = await get_live_source_state(input.db, input.workspace_id, source);
  if (live_state === 'answered') {
    return blocked('scout_source_answered', 'Someone already replied in this Slack thread.');
  }
  if (live_state === 'unavailable') {
    return blocked(
      'scout_source_check_unavailable',
      'The source thread could not be verified, so the scout action was not sent.',
    );
  }
  return null;
}

function find_source_reference_error(
  source_event_id: string,
  source_metadata: ScoutSourceMetadata | null,
) {
  if (!source_metadata?.[scout_config_key].observed_event_ids.includes(source_event_id)) {
    return blocked(
      'scout_source_unobserved',
      'The scout can act only on a Slack event from its current candidate list.',
    );
  }
  if (
    source_metadata[scout_config_key].source_event_id &&
    source_metadata[scout_config_key].source_event_id !== source_event_id
  ) {
    return blocked(
      'scout_source_unobserved',
      'This scheduled run can act only on the Slack event that created it.',
    );
  }
  return null;
}

export function build_scout_trigger_source(input: {
  actor_id: string;
  source_event_id: string | undefined;
  source_context: RuntimeToolSourceContext | undefined;
}): ScoutSourceMetadata | null {
  const source_metadata = get_scout_source_metadata(input.source_context?.source_metadata);
  if (!input.source_event_id || !is_scout_action(input.actor_id, source_metadata)) return null;
  return {
    [scout_config_key]: {
      source_event_id: input.source_event_id,
      observed_event_ids: [input.source_event_id],
    },
  };
}

function is_scout_action(actor_id: string, source_metadata: ScoutSourceMetadata | null) {
  if (actor_id === scout_actor) return true;
  return (
    actor_id === scheduled_task_actor &&
    Boolean(source_metadata?.[scout_config_key].source_event_id)
  );
}

function build_slack_delivery_action(tool_input: RuntimeCatalogToolInput): ScoutAction {
  return {
    action_type: 'deliver_to_slack',
    channel_id: tool_input.channel_id ?? null,
    thread_ts: tool_input.thread_ts ?? null,
  };
}

async function find_source_message(
  db: Database,
  workspace_id: string,
  source_event_id: string,
): Promise<ScoutSourceMessage | null> {
  const source = await db.query.events.findFirst({
    where: and(
      eq(events.workspace_id, workspace_id),
      eq(events.event_id, source_event_id),
      eq(events.source, 'slack'),
    ),
  });
  if (!source) return null;

  const body = source.event_body;
  const raw_payload = source.raw_payload;
  const raw_event = raw_payload.event;
  const team_id = body.team_id ?? raw_payload.team_id;
  const channel_id = body.channel_id ?? raw_event?.channel;
  const message_ts = body.event_ts ?? raw_event?.ts ?? raw_event?.event_ts;
  const sender_user_id = body.user_id ?? raw_event?.user;
  const text = (body.raw_text ?? body.text ?? raw_event?.text)?.trim();
  if (!team_id || !channel_id || !message_ts || !sender_user_id || !text) return null;

  return {
    event_id: source.event_id,
    queue_key: source.queue_key,
    team_id,
    channel_id,
    message_ts,
    sender_user_id,
    mentioned_user_ids: list_slack_mentions(text),
  };
}

function action_targets_source(action: ScoutAction, source: ScoutSourceMessage) {
  if (action.action_type === 'create_scheduled_task') return true;
  const is_source_thread =
    action.channel_id === source.channel_id && action.thread_ts === source.message_ts;
  const is_allowed_dm =
    action.thread_ts === null &&
    action.channel_id !== null &&
    [source.sender_user_id, ...source.mentioned_user_ids].includes(action.channel_id);
  return is_source_thread || is_allowed_dm;
}

async function source_has_persisted_reply(
  db: Database,
  workspace_id: string,
  source: ScoutSourceMessage,
) {
  const message_ts = sql<string>`coalesce(${events.event_body} ->> 'event_ts', ${events.raw_payload} -> 'event' ->> 'ts', ${events.raw_payload} -> 'event' ->> 'event_ts')`;
  const thread_ts = sql<string>`coalesce(${events.event_body} ->> 'thread_ts', ${events.raw_payload} -> 'event' ->> 'thread_ts')`;
  const reply = await db.query.events.findFirst({
    where: and(
      eq(events.workspace_id, workspace_id),
      eq(events.queue_key, source.queue_key),
      eq(events.source, 'slack'),
      ne(events.event_id, source.event_id),
      eq(thread_ts, source.message_ts),
      ne(message_ts, thread_ts),
    ),
  });
  return Boolean(reply);
}

async function get_live_source_state(
  db: Database,
  workspace_id: string,
  source: ScoutSourceMessage,
): Promise<'open' | 'answered' | 'unavailable'> {
  const connection = await find_active_slack_connection_for_workspace_team(db, {
    workspace_id,
    team_id: source.team_id,
  });
  const token = connection ? read_slack_bot_token(connection.credentials) : null;
  if (!token) return 'unavailable';

  try {
    const page = await fetch_slack_thread_replies_page(token, {
      channel_id: source.channel_id,
      thread_ts: source.message_ts,
      limit: 2,
    });
    if (!page.messages.some((message) => message.message_ts === source.message_ts)) {
      return 'unavailable';
    }
    return page.messages.some((message) => message.message_ts !== source.message_ts)
      ? 'answered'
      : 'open';
  } catch (error) {
    log.error('Slack source verification failed', {
      workspace_id,
      source_event_id: source.event_id,
      error: format_error_message(error),
    });
    return 'unavailable';
  }
}

function list_slack_mentions(text: string) {
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function blocked(code: string, message: string): RuntimeToolResult {
  return { success: false, error: { code, message } };
}
