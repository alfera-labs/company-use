import { z } from 'zod';

export const subject_field_candidates_by_slug_family: Record<string, readonly string[]> = {
  GMAIL_: ['thread_id'],
  OUTLOOK_: ['message.conversation_id', 'conversation_id'],
  // A Slack message belongs to its thread; a message that started no thread is its own thread.
  // `ts` alone, not channel+ts. Slack's ts is microsecond-precision, so a collision
  // across channels is not a real case. Upgrade path if it ever is: a composite subject field.
  SLACK_: ['thread_ts', 'ts'],
  NOTION_: ['page_id', 'database_id', 'data_source_id', 'comment_id', 'view_id'],
  GITHUB_: ['issue_number', 'pull_number', 'number', 'issue_id'],
  STRIPE_: ['data.object.id'],
  HUBSPOT_: ['objectId'],
  GOOGLEDRIVE_: ['file_id', 'file.id'],
  GOOGLECALENDAR_: ['event_id'],
};

export const default_subject_field_candidates = [
  'thread_id',
  'conversation_id',
  'message_id',
  'id',
] as const;

function subject_field_candidates(trigger_slug: string): string[] {
  const slug = trigger_slug.toUpperCase();
  const family = Object.entries(subject_field_candidates_by_slug_family).find(([prefix]) =>
    slug.startsWith(prefix),
  );
  return [...(family?.[1] ?? []), ...default_subject_field_candidates];
}

export function find_trigger_subject_field(input: {
  trigger_slug: string;
  output_schema: unknown;
}): string | null {
  return (
    subject_field_candidates(input.trigger_slug).find((path) =>
      schema_describes_path(input.output_schema, path),
    ) ?? null
  );
}

const properties_schema = z
  .object({ properties: z.record(z.string(), z.unknown()).catch({}) })
  .catch({ properties: {} });

function schema_describes_path(schema: unknown, path: string): boolean {
  let node: unknown = schema;
  for (const step of path.split('.')) {
    node = properties_schema.parse(node).properties[step];
    if (node === undefined) return false;
  }
  return true;
}

const listen_by_default_trigger_slugs = [
  'GMAIL_NEW_GMAIL_MESSAGE',
  'OUTLOOK_MESSAGE_TRIGGER',
  'STRIPE_PAYMENT_INTENT_PAYMENT_FAILED',
  'STRIPE_PAYMENT_INTENT_SUCCEEDED',
  'HUBSPOT_CONTACT_CREATED_TRIGGER',
  'GITHUB_ISSUE_CREATED_TRIGGER',
  'NOTION_PAGE_CREATED',
  'GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER',
  'GOOGLEDRIVE_FILE_CREATED_TRIGGER',
  // The user-token Slack ear. `SLACKBOT_RECEIVE_MESSAGE` is the same message read on a bot token,
  // so listening to both would hear every message twice.
  'SLACK_RECEIVE_MESSAGE',
] as const;

const listen_by_default = new Set<string>(listen_by_default_trigger_slugs);

export function is_listen_by_default_trigger(trigger_slug: string | null | undefined) {
  return Boolean(trigger_slug && listen_by_default.has(trigger_slug.toUpperCase()));
}
