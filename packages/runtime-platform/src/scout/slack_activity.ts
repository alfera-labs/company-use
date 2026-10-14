import { type Database, events } from '@coworker/core';
import {
  deduplicate_slack_channel_files,
  read_slack_channel_files,
  type SlackChannelFile,
} from '@runtime-platform/channels/slack/channel_routing';
import type { SlackMessageEvent } from '@runtime-platform/channels/slack/slack_event_payload';
import {
  list_answered_thread_keys,
  load_mention_context,
  message_mentions_only_people,
  read_slack_mentions,
} from '@runtime-platform/scout/slack_activity_filters';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';

type EventRow = typeof events.$inferSelect;

const recent_activity_window_ms = 7 * 24 * 60 * 60 * 1000;
type ScoutEventBody = {
  team_id?: string;
  channel_id?: string;
  channel_type?: string;
  event_ts?: string;
  user_id?: string;
  raw_text?: string;
  text?: string;
  files?: unknown;
};

export type ScoutSlackActivity = {
  event_id: string;
  queue_key: string;
  event_status: string;
  team_id: string | null;
  channel_id: string;
  channel_type: string | null;
  message_ts: string;
  reply_thread_ts: string;
  sender_user_id: string;
  mentioned_user_ids: string[];
  text: string;
  attachments: ScoutSlackAttachment[];
  omitted_attachment_count?: number;
  created_time: string;
};

type ScoutSlackAttachment = SlackChannelFile & {
  attachment_id: string;
};

export async function list_open_slack_activity(
  db: Database,
  input: { workspace_id: string; limit: number; now?: Date },
): Promise<ScoutSlackActivity[]> {
  const now = input.now ?? new Date();
  const message_ts = sql<string>`coalesce(${events.event_body} ->> 'event_ts', ${events.raw_payload} -> 'event' ->> 'ts', ${events.raw_payload} -> 'event' ->> 'event_ts')`;
  const thread_ts = sql<
    string | null
  >`coalesce(${events.event_body} ->> 'thread_ts', ${events.raw_payload} -> 'event' ->> 'thread_ts')`;
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.source, 'slack'),
        inArray(events.event_type, ['message', 'app_mention']),
        gte(events.created_time, new Date(now.getTime() - recent_activity_window_ms)),
        eq(events.event_status, 'ignored'),
        sql`${events.metadata} ->> 'ignored_reason' = 'top_level_mention_required'`,
        or(isNull(thread_ts), eq(thread_ts, message_ts)),
      ),
    )
    .orderBy(desc(events.created_time))
    .limit(input.limit * 3);

  const activity = rows.flatMap(read_slack_activity);
  if (activity.length === 0) return [];

  const [answered_thread_keys, mention_context] = await Promise.all([
    list_answered_thread_keys(db, input.workspace_id, activity),
    load_mention_context(db, input.workspace_id, activity),
  ]);
  return activity
    .filter(
      (message) =>
        !answered_thread_keys.has(message.queue_key) &&
        message_mentions_only_people(message, mention_context),
    )
    .slice(0, input.limit);
}

function read_slack_activity(row: EventRow): ScoutSlackActivity[] {
  const body = row.event_body as ScoutEventBody | null;
  const raw_payload = row.raw_payload;
  const raw_event = raw_payload?.event;
  const changed_message = raw_event?.message;
  const channel_id = body?.channel_id ?? raw_event?.channel;
  const message_ts = body?.event_ts ?? raw_event?.ts ?? raw_event?.event_ts;
  const sender_user_id = body?.user_id ?? raw_event?.user ?? changed_message?.user;
  const text =
    normalize_message_text(body?.raw_text) ??
    normalize_message_text(body?.text) ??
    normalize_message_text(raw_event?.text) ??
    normalize_message_text(changed_message?.text);
  const team_id = body?.team_id ?? raw_payload?.team_id ?? null;
  const attachments = read_scout_attachments(team_id, body, raw_event, changed_message);
  if (!channel_id || !message_ts || !sender_user_id || (!text && attachments.length === 0)) {
    return [];
  }

  return [
    {
      event_id: row.event_id,
      queue_key: row.queue_key,
      event_status: row.event_status,
      team_id,
      channel_id,
      channel_type: body?.channel_type ?? raw_event?.channel_type ?? null,
      message_ts,
      reply_thread_ts: message_ts,
      sender_user_id,
      mentioned_user_ids: read_slack_mentions(text ?? ''),
      text: text?.slice(0, 4_000) ?? '[Slack message with attachments]',
      attachments,
      created_time: row.created_time.toISOString(),
    },
  ];
}

function read_scout_attachments(
  team_id: string | null,
  body: ScoutEventBody | null,
  raw_event: SlackMessageEvent | undefined,
  changed_message: SlackMessageEvent['message'],
): ScoutSlackAttachment[] {
  if (!team_id) return [];
  const files = deduplicate_slack_channel_files([
    ...read_slack_channel_files(body?.files),
    ...read_slack_channel_files(raw_event?.files),
    ...read_slack_channel_files(changed_message?.files),
  ]);
  return files.map((file) => ({
    ...file,
    attachment_id: `slack:${team_id}:${file.external_file_id}`,
  }));
}

function normalize_message_text(value: string | undefined) {
  const text = value?.trim();
  return text || null;
}
