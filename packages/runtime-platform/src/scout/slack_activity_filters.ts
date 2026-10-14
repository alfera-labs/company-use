import { type Database, events } from '@coworker/core';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  load_slack_user_directory,
  type SlackUserDirectory,
} from '@runtime-platform/channels/slack/directory';
import { find_active_slack_connection_for_workspace } from '@runtime-platform/channels/slack/workspace_connection';
import type { ScoutSlackActivity } from '@runtime-platform/scout/slack_activity';
import { read_slack_bot_token } from '@runtime-platform/tools/slack/channels_api';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

const log = create_logger('scout_slack_activity_filters');

export async function list_answered_thread_keys(
  db: Database,
  workspace_id: string,
  activity: ScoutSlackActivity[],
) {
  const message_ts = sql<string>`coalesce(${events.event_body} ->> 'event_ts', ${events.raw_payload} -> 'event' ->> 'ts', ${events.raw_payload} -> 'event' ->> 'event_ts')`;
  const thread_ts = sql<string>`coalesce(${events.event_body} ->> 'thread_ts', ${events.raw_payload} -> 'event' ->> 'thread_ts')`;
  const rows = await db
    .selectDistinct({ queue_key: events.queue_key })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, workspace_id),
        eq(events.source, 'slack'),
        inArray(
          events.queue_key,
          activity.map((message) => message.queue_key),
        ),
        ne(message_ts, thread_ts),
      ),
    );
  return new Set(rows.map((row) => row.queue_key));
}

type MentionContext = {
  known_user_ids: Set<string>;
  bot_user_ids: Set<string>;
};

export async function load_mention_context(
  db: Database,
  workspace_id: string,
  activity: ScoutSlackActivity[],
): Promise<MentionContext | null> {
  if (activity.every((message) => message.mentioned_user_ids.length === 0)) {
    return { known_user_ids: new Set(), bot_user_ids: new Set() };
  }

  const connection = await find_active_slack_connection_for_workspace(db, workspace_id);
  const token = read_slack_bot_token(connection);
  if (!token) return null;

  try {
    return mention_context_from_directory(await load_slack_user_directory(token));
  } catch (error) {
    log.error('Slack directory unavailable; skipping mentioned scout messages', {
      workspace_id,
      error: format_error_message(error),
    });
    return null;
  }
}

function mention_context_from_directory(directory: SlackUserDirectory): MentionContext {
  return {
    known_user_ids: new Set(directory.members.map((member) => member.user_id)),
    bot_user_ids: new Set(
      directory.members.filter((member) => member.is_bot).map((member) => member.user_id),
    ),
  };
}

export function message_mentions_only_people(
  message: ScoutSlackActivity,
  context: MentionContext | null,
) {
  if (message.mentioned_user_ids.length === 0) return true;
  if (!context) return false;
  return message.mentioned_user_ids.every(
    (user_id) => context.known_user_ids.has(user_id) && !context.bot_user_ids.has(user_id),
  );
}

export function read_slack_mentions(text: string) {
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}
