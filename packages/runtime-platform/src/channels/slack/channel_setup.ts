import { agents, channels, type Database } from '@coworker/core';
import { upsert_default_agent_for_workspace } from '@coworker/core/db/queries/bootstrap';
import { merge_metadata } from '@coworker/core/db/schema/common';
import { create_id, id_prefixes } from '@coworker/shared';
import {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

export type SlackConnectionForChannelSetup = {
  connection_id: string;
  workspace_id: string;
  provider_key?: string | null;
  provider_config_key?: string | null;
  connection_profile_key?: string | null;
  external_account_id?: string | null;
  external_account_name?: string | null;
};

export type SlackChannelAccessStatus = 'enabled' | 'disabled';

export async function list_slack_channel_access_rows(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    external_account_id: string;
    external_conversation_ids: string[];
  },
) {
  if (input.external_conversation_ids.length === 0) return [];

  return db.query.channels.findMany({
    where: and(
      eq(channels.workspace_id, input.workspace_id),
      eq(channels.channel_provider_key, 'slack'),
      eq(channels.connection_id, input.connection_id),
      eq(channels.external_account_id, input.external_account_id),
      isNotNull(channels.external_conversation_id),
      inArray(channels.external_conversation_id, input.external_conversation_ids),
    ),
  });
}

export async function set_slack_channel_access(
  db: Database,
  input: {
    connection: SlackConnectionForChannelSetup;
    external_conversation_id: string;
    conversation_scope: 'channel' | 'group';
    channel_status: SlackChannelAccessStatus;
    channel_name?: string | null;
    // The project conversations in this channel start in. Absent keeps whatever the route has;
    // null takes it out of any project.
    project_id?: string | null;
    actor_id: string;
  },
) {
  const agent = await upsert_default_agent_for_workspace(db, {
    workspace_id: input.connection.workspace_id,
    actor_id: input.actor_id,
  });
  const values = slack_channel_access_values(input, agent.agent_id);
  const existing_channel = await db.query.channels.findFirst({
    where: and(
      eq(channels.workspace_id, values.workspace_id),
      eq(channels.channel_key, values.channel_key),
    ),
  });

  if (existing_channel) {
    const [channel] = await db
      .update(channels)
      .set({
        channel_name: values.channel_name,
        channel_status: values.channel_status,
        connection_id: values.connection_id,
        external_account_id: values.external_account_id,
        external_conversation_id: values.external_conversation_id,
        conversation_scope: values.conversation_scope,
        routing_priority: values.routing_priority,
        target_kind: values.target_kind,
        target_id: values.target_id,
        channel_source: values.channel_source,
        channel_target: values.channel_target,
        ...(input.project_id === undefined ? {} : { project_id: input.project_id }),
        metadata: sql`coalesce(${channels.metadata}, '{}'::jsonb) || ${JSON.stringify(
          values.metadata,
        )}::jsonb`,
        last_updated_time: new Date(),
        last_updated_by: input.actor_id,
      })
      .where(eq(channels.channel_id, existing_channel.channel_id))
      .returning();

    return channel ?? null;
  }

  const [channel] = await db
    .insert(channels)
    .values({
      channel_id: create_id(id_prefixes.channel),
      ...values,
      project_id: input.project_id ?? null,
    })
    .returning();

  return channel ?? null;
}

export async function upsert_default_slack_channel_for_connection(
  db: Database,
  input: {
    connection: SlackConnectionForChannelSetup;
    actor_id: string;
  },
) {
  if (!is_native_slack_connection(input.connection)) return null;

  const agent = await upsert_default_agent_for_workspace(db, {
    workspace_id: input.connection.workspace_id,
    actor_id: input.actor_id,
  });
  const values = default_slack_channel_values(input.connection, agent.agent_id, input.actor_id);
  const existing_channel = await db.query.channels.findFirst({
    where: and(
      eq(channels.workspace_id, values.workspace_id),
      eq(channels.channel_key, values.channel_key),
    ),
  });
  if (existing_channel) {
    const [channel] = await db
      .update(channels)
      .set({
        connection_id: values.connection_id,
        channel_name: values.channel_name,
        channel_status: 'enabled',
        external_account_id: values.external_account_id,
        external_conversation_id: values.external_conversation_id,
        external_thread_id: values.external_thread_id,
        conversation_scope: values.conversation_scope,
        target_kind: values.target_kind,
        target_id: values.target_id,
        channel_source: values.channel_source,
        channel_config: values.channel_config,
        channel_target: values.channel_target,
        metadata: merge_metadata(channels.metadata, values.metadata ?? {}),
        last_updated_time: new Date(),
        last_updated_by: input.actor_id,
      })
      .where(eq(channels.channel_id, existing_channel.channel_id))
      .returning();

    return channel ?? null;
  }

  const [channel] = await db.insert(channels).values(values).returning();

  return channel ?? null;
}

function default_slack_channel_values(
  connection: SlackConnectionForChannelSetup,
  agent_id: string,
  actor_id: string,
): typeof channels.$inferInsert {
  return {
    channel_id: `chn_slack_${connection.connection_id}`,
    channel_key: build_default_slack_channel_key(connection),
    workspace_id: connection.workspace_id,
    connection_id: connection.connection_id,
    channel_provider_key: 'slack',
    channel_name: connection.external_account_name
      ? `Slack: ${connection.external_account_name}`
      : 'Slack workspace',
    channel_status: 'enabled',
    external_account_id: connection.external_account_id ?? null,
    external_conversation_id: null,
    external_thread_id: null,
    conversation_scope: 'any',
    routing_priority: 0,
    target_kind: 'agent',
    target_id: agent_id,
    channel_source: {
      channel_provider_key: 'slack',
      connection_id: connection.connection_id,
      external_account_id: connection.external_account_id ?? null,
      external_conversation_id: null,
      external_thread_id: null,
      conversation_scope: 'any',
    },
    channel_config: {
      channel_policy: {
        require_bot_mention_in_channels: true,
      },
      context_backfill: {
        thread_initial_limit: 20,
        channel_recent_limit: 0,
      },
    },
    channel_target: {
      kind: 'agent_run',
      agent_id,
    },
    metadata: {
      source: 'slack_oauth_default_channel',
      connection_id: connection.connection_id,
    },
    created_by: actor_id,
    last_updated_by: actor_id,
  };
}

function slack_channel_access_values(
  input: {
    connection: SlackConnectionForChannelSetup;
    external_conversation_id: string;
    conversation_scope: 'channel' | 'group';
    channel_status: SlackChannelAccessStatus;
    channel_name?: string | null;
    actor_id: string;
  },
  agent_id: string,
): Omit<typeof channels.$inferInsert, 'channel_id'> {
  const channel_key = build_slack_channel_access_key(
    input.connection.external_account_id,
    input.external_conversation_id,
  );

  return {
    channel_key,
    workspace_id: input.connection.workspace_id,
    connection_id: input.connection.connection_id,
    channel_provider_key: 'slack',
    channel_name: input.channel_name ?? input.external_conversation_id,
    channel_status: input.channel_status,
    external_account_id: input.connection.external_account_id ?? null,
    external_conversation_id: input.external_conversation_id,
    external_thread_id: null,
    conversation_scope: input.conversation_scope,
    routing_priority: 100,
    target_kind: 'agent',
    target_id: agent_id,
    channel_source: {
      channel_provider_key: 'slack',
      connection_id: input.connection.connection_id,
      external_account_id: input.connection.external_account_id ?? null,
      external_conversation_id: input.external_conversation_id,
      external_thread_id: null,
      conversation_scope: input.conversation_scope,
    },
    channel_config: {
      channel_policy: {
        require_bot_mention_in_channels: true,
      },
    },
    channel_target: {
      kind: 'agent_run',
      agent_id,
    },
    metadata: {
      source: 'slack_channel_settings',
      connection_id: input.connection.connection_id,
    },
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  };
}

export async function find_slack_channel_agent_for_event(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    external_account_id: string;
    external_conversation_id: string;
    conversation_scope: string;
    external_thread_id?: string | undefined;
  },
) {
  const candidates = await db.query.channels.findMany({
    where: and(
      eq(channels.workspace_id, input.workspace_id),
      eq(channels.channel_provider_key, 'slack'),
      eq(channels.target_kind, 'agent'),
      or(eq(channels.connection_id, input.connection_id), isNull(channels.connection_id)),
      or(
        eq(channels.external_account_id, input.external_account_id),
        isNull(channels.external_account_id),
      ),
      or(
        eq(channels.external_conversation_id, input.external_conversation_id),
        isNull(channels.external_conversation_id),
      ),
      or(
        eq(channels.external_thread_id, input.external_thread_id ?? ''),
        isNull(channels.external_thread_id),
      ),
      or(
        eq(channels.conversation_scope, input.conversation_scope),
        ...(input.conversation_scope === 'thread'
          ? [eq(channels.conversation_scope, 'channel'), eq(channels.conversation_scope, 'group')]
          : []),
        eq(channels.conversation_scope, 'any'),
      ),
    ),
  });
  const channel = candidates.sort(
    (left, right) => score_slack_channel(input, right) - score_slack_channel(input, left),
  )[0];
  if (!channel || channel.channel_status !== 'enabled') return null;

  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.workspace_id, input.workspace_id), eq(agents.agent_id, channel.target_id)),
  });
  if (!agent || agent.agent_status !== 'active') return null;
  return { channel, agent };
}

function score_slack_channel(
  input: {
    connection_id: string;
    external_account_id: string;
    external_conversation_id: string;
    conversation_scope: string;
    external_thread_id?: string | undefined;
  },
  channel: typeof channels.$inferSelect,
) {
  return (
    channel.routing_priority +
    score_exact_match(channel.connection_id, input.connection_id) +
    score_exact_match(channel.external_account_id, input.external_account_id) +
    score_exact_match(channel.external_conversation_id, input.external_conversation_id) +
    score_exact_match(channel.external_thread_id, input.external_thread_id) +
    score_conversation_scope_match(channel.conversation_scope, input.conversation_scope)
  );
}

function score_exact_match(value: string | null, expected: string | undefined) {
  return value !== null && value === expected ? 1 : 0;
}

function score_conversation_scope_match(value: string | null, expected: string) {
  if (value === expected) return 1;
  if (expected === 'thread' && value === 'channel') return 0.5;
  return 0;
}

function build_default_slack_channel_key(connection: SlackConnectionForChannelSetup) {
  return `slack-${normalize_slack_channel_key(connection.external_account_id)}-all`;
}

function build_slack_channel_access_key(
  external_account_id: string | null | undefined,
  external_conversation_id: string,
) {
  return `slack-${normalize_slack_channel_key(external_account_id)}-${normalize_slack_channel_key(
    external_conversation_id,
  )}`;
}

function normalize_slack_channel_key(value: string | null | undefined) {
  const slug = (value ?? 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'workspace';
}

function is_native_slack_connection(connection: SlackConnectionForChannelSetup) {
  return (
    connection.provider_key === native_slack_provider_key &&
    connection.provider_config_key === native_slack_provider_config_key &&
    connection.connection_profile_key === native_slack_connection_profile_key &&
    typeof connection.external_account_id === 'string' &&
    connection.external_account_id.length > 0
  );
}
