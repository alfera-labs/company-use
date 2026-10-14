import { apps, type Database, nodes } from '@coworker/core';
import { get_composio_app_by_toolkit } from '@coworker/core/db/queries/catalog';
import { create_id, id_prefixes } from '@coworker/shared';
import { native_slack_app_name } from '@runtime-platform/tools/slack/app_profile';
import { and, eq, isNull } from 'drizzle-orm';

const actor_id = 'system:native_trigger_catalog';

const native_trigger_handler_prefix = 'native.trigger.';

export const native_trigger_node_keys = {
  inbound_email: 'alfera_email-message_received-1',
  notification_written: 'notifications-notification_written-1',
  slack_message: 'slack-message_received-1',
  google_calendar_event_offset: 'googlecalendar-event_offset-1',
  outlook_calendar_event_offset: 'outlook-event_offset-1',
} as const;

export const calendar_offset_minutes_limit = 20_160;

const calendar_offset_input_schema = {
  type: 'object' as const,
  properties: {
    calendar_node_key: {
      type: 'string',
      title: 'Calendar',
      description:
        "Which calendar to read. Defaults to the workspace's one connected calendar, which is the usual case.",
    },
    offset_minutes: {
      type: 'integer',
      title: 'Minutes from the event',
      description:
        'Minutes from the event. Negative is before it, positive is after it. "Five minutes after the call ends" is offset_minutes 5 with relative_to "end".',
    },
    relative_to: {
      type: 'string',
      title: 'Counted from',
      enum: ['start', 'end'],
      default: 'start',
      description: 'Count the minutes from the event start (the default) or from its end.',
    },
  },
  required: ['offset_minutes'],
};

const slack_message_input_schema = {
  type: 'object' as const,
  properties: {
    channel_id: {
      type: 'string',
      title: 'Channel',
      description: 'Only this channel; leave empty for every channel the app is in.',
    },
  },
};

type NativeTriggerSeed = {
  app_name: string;
  app_display_name: string;
  app_category: string;
  node_name: string;
  node_key: string;
  node_display_name: string;
  runtime_handler: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  requires_existing_app?: boolean;
  composio_toolkit_slug?: string;
  data_fields: string[];
  subject_field: string;
};

const native_trigger_seeds: NativeTriggerSeed[] = [
  {
    app_name: 'alfera_email',
    app_display_name: 'Alfera email',
    app_category: 'internal',
    node_name: 'message_received',
    node_key: native_trigger_node_keys.inbound_email,
    node_display_name: 'Someone emails your coworker',
    runtime_handler: `${native_trigger_handler_prefix}email_received`,
    data_fields: ['thread_id', 'sender', 'subject', 'message_text', 'message_id', 'received_time'],
    subject_field: 'thread_id',
  },
  {
    app_name: 'notifications',
    app_display_name: 'Notifications',
    app_category: 'internal',
    node_name: 'notification_written',
    node_key: native_trigger_node_keys.notification_written,
    node_display_name: 'Your coworker notices something',
    runtime_handler: `${native_trigger_handler_prefix}notification_written`,
    data_fields: ['title', 'urgency', 'outcome', 'score', 'automation_id', 'subject', 'evidence'],
    subject_field: 'subject',
  },
  {
    app_name: native_slack_app_name,
    app_display_name: 'Slack',
    app_category: 'communication',
    node_name: 'message_received',
    node_key: native_trigger_node_keys.slack_message,
    node_display_name: 'Someone writes in Slack',
    runtime_handler: `${native_trigger_handler_prefix}slack_message_received`,
    input_schema: slack_message_input_schema,
    description:
      'Every message a person writes in the Slack app you connected in Settings — channels, DMs, and thread replies, whether or not the coworker is mentioned. No other setup.',
    requires_existing_app: true,
    data_fields: [
      'thread_id',
      'channel_id',
      'channel_type',
      'user_id',
      'text',
      'ts',
      'is_thread_reply',
      'is_mention',
    ],
    subject_field: 'thread_id',
  },
  ...calendar_offset_seeds(),
];

function calendar_offset_seeds(): NativeTriggerSeed[] {
  return [
    { app_name: 'googlecalendar', app_display_name: 'Google Calendar' },
    { app_name: 'outlook', app_display_name: 'Outlook' },
  ].map((app) => ({
    app_name: app.app_name,
    app_display_name: app.app_display_name,
    app_category: 'productivity',
    node_name: 'event_offset',
    node_key: `${app.app_name}-event_offset-1`,
    node_display_name: 'Before or after an event',
    runtime_handler: `${native_trigger_handler_prefix}calendar_event_offset`,
    input_schema: calendar_offset_input_schema,
    composio_toolkit_slug: app.app_name,
    data_fields: ['event_id', 'summary', 'start', 'end', 'attendees', 'location', 'organizer'],
    subject_field: 'event_id',
  }));
}

export function is_native_trigger_node(node: { node_kind: string; runtime_handler: string }) {
  return (
    node.node_kind === 'trigger' && node.runtime_handler.startsWith(native_trigger_handler_prefix)
  );
}

export function is_native_trigger_node_key(node_key: string | undefined) {
  return Object.values<string>(native_trigger_node_keys).includes(node_key ?? '');
}

export async function seed_native_trigger_catalog(db: Database) {
  for (const seed of native_trigger_seeds) {
    const app = await find_native_app(db, seed);
    if (!app) continue;
    await upsert_native_trigger_node(db, app, seed);
  }
}

async function find_native_app(db: Database, seed: NativeTriggerSeed) {
  if (seed.composio_toolkit_slug) {
    return get_composio_app_by_toolkit(db, { toolkit_slug: seed.composio_toolkit_slug });
  }
  const existing = await find_global_app(db, seed.app_name);
  if (existing || seed.requires_existing_app) return existing ?? null;
  return create_native_app(db, seed);
}

function find_global_app(db: Database, app_name: string) {
  return db.query.apps.findFirst({
    where: and(
      eq(apps.app_name, app_name),
      eq(apps.catalog_scope, 'global'),
      isNull(apps.workspace_id),
    ),
  });
}

async function create_native_app(db: Database, seed: NativeTriggerSeed) {
  const [app] = await db
    .insert(apps)
    .values({
      app_id: create_id(id_prefixes.app),
      app_name: seed.app_name,
      app_key: seed.app_name,
      catalog_scope: 'global',
      app_display_name: seed.app_display_name,
      app_category: seed.app_category,
      auth_type: 'none',
      app_status: 'active',
      display_config: {},
      metadata: {
        sourced_from: { provider: 'native', provider_app_id: `native:${seed.app_name}` },
      },
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .returning();
  if (!app) throw new Error(`Native trigger app seed failed: ${seed.app_name}`);
  return app;
}

async function upsert_native_trigger_node(
  db: Database,
  app: typeof apps.$inferSelect,
  seed: NativeTriggerSeed,
) {
  const values = {
    app_id: app.app_id,
    app_key: app.app_key,
    catalog_scope: 'global',
    node_key: seed.node_key,
    node_version: 1,
    node_name: seed.node_name,
    node_display_name: seed.node_display_name,
    node_kind: 'trigger',
    input_schema: seed.input_schema ?? { type: 'object' as const, properties: {} },
    runtime_handler: seed.runtime_handler,
    node_runtime: 'native_tool',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'native',
    provider_config_key: `native:${seed.app_name}`,
    provider_config_version: 1,
    node_config: {
      sourced_from: {
        provider: 'native',
        provider_app_id: `native:${seed.app_name}`,
        provider_component_id: seed.runtime_handler,
        provider_component_version: '1',
      },
      subject_field: seed.subject_field,
    },
    metadata: {
      source: 'native_trigger_catalog',
      data_fields: seed.data_fields,
      ...(seed.description ? { description: seed.description } : {}),
    },
  };

  const [node] = await db
    .insert(nodes)
    .values({
      node_id: create_id(id_prefixes.node),
      ...values,
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .onConflictDoUpdate({
      target: [nodes.app_id, nodes.node_name],
      set: { ...values, last_updated_time: new Date(), last_updated_by: actor_id },
    })
    .returning({ node_id: nodes.node_id });
  if (!node) throw new Error(`Native trigger node seed failed: ${seed.node_key}`);
}
