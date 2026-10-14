import type { Database } from '@coworker/core';
import {
  type MemoryScopeGrantsSweepResult,
  replace_memory_scope_grants,
} from '@coworker/core/db/queries/memory_scope_grants';
import type { MemoryScopeMember } from '@coworker/core/db/queries/resource_grants_memory_scope_sweep';
import { upsert_source_actor } from '@coworker/core/db/queries/source_actors';
import { WebClient } from '@slack/web-api';

export type SlackMemberSyncInput = {
  db: Database;
  workspace_id: string;
  team_id: string;
  channel_id: string;
  token: string;
  sweep_id: string;
  swept_time: Date;
  actor_id: string;
};

type SlackGuestFlags = { is_restricted: boolean; is_ultra_restricted: boolean };

const max_member_list_pages = 25;
const member_list_page_size = 200;
const guest_profile_lookup_concurrency = 8;

export function slack_channel_scope_key(team_id: string, channel_id: string): string {
  return `group:slack:${team_id}:${channel_id}`;
}

export async function sync_slack_channel_members(
  input: SlackMemberSyncInput,
): Promise<MemoryScopeGrantsSweepResult> {
  const client = new WebClient(input.token);
  const member_ids = await list_slack_channel_member_ids(client, input.channel_id);
  const members = await map_with_limited_concurrency(
    member_ids,
    guest_profile_lookup_concurrency,
    (user_id) => build_scope_member(client, input, user_id),
  );
  return replace_memory_scope_grants(input.db, {
    workspace_id: input.workspace_id,
    scope_key: slack_channel_scope_key(input.team_id, input.channel_id),
    sweep_id: input.sweep_id,
    swept_time: input.swept_time,
    members,
    actor_id: input.actor_id,
  });
}

async function list_slack_channel_member_ids(
  client: WebClient,
  channel_id: string,
): Promise<string[]> {
  return list_member_pages_in_order(client, channel_id, undefined, 0);
}

async function list_member_pages_in_order(
  client: WebClient,
  channel_id: string,
  cursor: string | undefined,
  pages_read: number,
): Promise<string[]> {
  const response = await client.conversations.members({
    channel: channel_id,
    limit: member_list_page_size,
    ...(cursor ? { cursor } : {}),
  });
  const page_member_ids = response.members ?? [];
  const next_cursor = response.response_metadata?.next_cursor || undefined;
  if (!next_cursor || pages_read + 1 >= max_member_list_pages) return page_member_ids;
  const later_member_ids = await list_member_pages_in_order(
    client,
    channel_id,
    next_cursor,
    pages_read + 1,
  );
  return [...page_member_ids, ...later_member_ids];
}

async function read_slack_guest_flags(
  client: WebClient,
  user_id: string,
): Promise<SlackGuestFlags | null> {
  try {
    const response = await client.users.info({ user: user_id });
    const user = response.user;
    if (!user) return null;
    return {
      is_restricted: user.is_restricted === true,
      is_ultra_restricted: user.is_ultra_restricted === true,
    };
  } catch {
    return null;
  }
}

function member_kind_for(flags: SlackGuestFlags | null): MemoryScopeMember['member_kind'] {
  return flags?.is_restricted || flags?.is_ultra_restricted ? 'guest' : 'member';
}

async function build_scope_member(
  client: WebClient,
  input: SlackMemberSyncInput,
  user_id: string,
): Promise<MemoryScopeMember> {
  const flags = await read_slack_guest_flags(client, user_id);
  const actor = await upsert_source_actor(input.db, {
    workspace_id: input.workspace_id,
    provider: 'slack',
    external_id: user_id,
    actor_id: input.actor_id,
  });
  return {
    grantee_type: 'source_actor',
    grantee_id: actor.source_actor_id,
    member_kind: member_kind_for(flags),
  };
}

async function map_with_limited_concurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next_index = 0;
  const worker = async (): Promise<void> => {
    if (next_index >= items.length) return;
    const index = next_index++;
    results[index] = await run(items[index] as T);
    return worker();
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
