import type { Database } from '@coworker/core/db/connection';
import { channels } from '@coworker/core/db/schema';
import type { ChannelConfigData } from '@coworker/core/db/schema/json_column_types';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, isNull, or } from 'drizzle-orm';

type ChannelConversationScope = 'any' | 'dm' | 'group' | 'channel' | 'thread';

export type ChannelStatus = 'enabled' | 'disabled' | 'error';

type ChannelTargetKind = 'agent' | 'workflow' | 'node' | 'system';

export type CreateChannelInput = {
  workspace_id: string;
  connection_id?: string | null;
  channel_key?: string | null;
  channel_provider_key: string;
  channel_name?: string | null;
  external_account_id?: string | null;
  external_conversation_id?: string | null;
  external_thread_id?: string | null;
  conversation_scope?: ChannelConversationScope;
  routing_priority?: number;
  target_kind: ChannelTargetKind;
  target_id: string;
  channel_source?: Record<string, unknown>;
  channel_config?: ChannelConfigData;
  channel_target?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  actor_id: string;
};

export type FindChannelForAgentEventInput = {
  workspace_id: string;
  agent_id: string;
  connection_id: string;
  channel_provider_key: string;
  external_account_id: string;
  external_conversation_id: string;
  external_thread_id?: string | undefined;
  conversation_scope: Exclude<ChannelConversationScope, 'any'>;
};

export async function list_channels(db: Database, workspace_id: string) {
  return db.query.channels.findMany({
    where: eq(channels.workspace_id, workspace_id),
    orderBy: (table, { asc }) => [asc(table.channel_key)],
  });
}

export async function create_channel(db: Database, input: CreateChannelInput) {
  const channel_id = create_id(id_prefixes.channel);
  const [channel] = await db
    .insert(channels)
    .values({
      channel_id,
      channel_key: input.channel_key ?? build_generated_channel_key(input, channel_id),
      workspace_id: input.workspace_id,
      connection_id: input.connection_id ?? null,
      channel_provider_key: input.channel_provider_key,
      channel_name: input.channel_name ?? null,
      channel_status: 'enabled',
      external_account_id: input.external_account_id ?? null,
      external_conversation_id: input.external_conversation_id ?? null,
      external_thread_id: input.external_thread_id ?? null,
      conversation_scope: input.conversation_scope ?? 'any',
      routing_priority: input.routing_priority ?? 0,
      target_kind: input.target_kind,
      target_id: input.target_id,
      channel_source: input.channel_source ?? build_channel_source(input),
      channel_config: input.channel_config ?? {},
      channel_target: input.channel_target ?? build_channel_target(input),
      metadata: input.metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_channel(channel);
}

export async function update_channel_status(
  db: Database,
  input: {
    workspace_id: string;
    channel_id: string;
    channel_status: ChannelStatus;
    actor_id: string;
  },
) {
  const [channel] = await db
    .update(channels)
    .set({
      channel_status: input.channel_status,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(channels.workspace_id, input.workspace_id), eq(channels.channel_id, input.channel_id)),
    )
    .returning();

  return require_inserted_channel(channel);
}

export async function find_channel_for_agent_event(
  db: Database,
  input: FindChannelForAgentEventInput,
) {
  const candidates = await db.query.channels.findMany({
    where: and(
      eq(channels.workspace_id, input.workspace_id),
      eq(channels.channel_provider_key, input.channel_provider_key),
      eq(channels.channel_status, 'enabled'),
      eq(channels.target_kind, 'agent'),
      eq(channels.target_id, input.agent_id),
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
          ? [eq(channels.conversation_scope, 'channel')]
          : []),
        eq(channels.conversation_scope, 'any'),
      ),
    ),
  });

  return candidates.sort((left, right) => compare_channel_matches(input, left, right))[0];
}

function build_channel_source(input: CreateChannelInput) {
  return {
    channel_provider_key: input.channel_provider_key,
    connection_id: input.connection_id ?? null,
    external_account_id: input.external_account_id ?? null,
    external_conversation_id: input.external_conversation_id ?? null,
    external_thread_id: input.external_thread_id ?? null,
    conversation_scope: input.conversation_scope ?? 'any',
  };
}

function build_generated_channel_key(input: CreateChannelInput, channel_id: string) {
  const stem = normalize_channel_key_stem(
    input.channel_name ?? input.external_conversation_id ?? input.channel_provider_key,
  );
  return `${stem}-${channel_id_suffix(channel_id)}`;
}

function normalize_channel_key_stem(value: string | null | undefined) {
  const stem = (value ?? 'channel')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return stem || 'channel';
}

function channel_id_suffix(channel_id: string) {
  return (channel_id.split('_')[1] ?? channel_id).slice(0, 8);
}

function build_channel_target(input: CreateChannelInput) {
  if (input.target_kind === 'agent') {
    return { kind: 'agent_run', agent_id: input.target_id };
  }
  if (input.target_kind === 'workflow') {
    return { kind: 'workflow_run', workflow_id: input.target_id };
  }
  if (input.target_kind === 'node') {
    return { kind: 'node_run', node_id: input.target_id };
  }
  return { kind: 'system_event', target_id: input.target_id };
}

function compare_channel_matches(
  input: FindChannelForAgentEventInput,
  left: typeof channels.$inferSelect,
  right: typeof channels.$inferSelect,
) {
  return (
    right.routing_priority - left.routing_priority ||
    score_channel_match(input, right) - score_channel_match(input, left) ||
    left.created_time.getTime() - right.created_time.getTime()
  );
}

function score_channel_match(
  input: FindChannelForAgentEventInput,
  channel: typeof channels.$inferSelect,
) {
  return (
    score_exact_match(channel.connection_id, input.connection_id) +
    score_exact_match(channel.external_account_id, input.external_account_id) +
    score_exact_match(channel.external_conversation_id, input.external_conversation_id) +
    score_exact_match(channel.external_thread_id, input.external_thread_id) +
    score_conversation_scope_match(channel.conversation_scope, input.conversation_scope)
  );
}

function score_exact_match(value: string | null, expected: string | undefined) {
  return value === expected ? 1 : 0;
}

function score_conversation_scope_match(value: string | null, expected: string) {
  if (value === expected) return 1;
  if (expected === 'thread' && value === 'channel') return 0.5;
  return 0;
}

function require_inserted_channel(channel: typeof channels.$inferSelect | undefined) {
  if (!channel) throw new Error('Channel was not inserted');
  return channel;
}
