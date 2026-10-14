import type { GranteeType } from '@coworker/core/access/may_use_resource';
import { memory_scope_resource_type } from '@coworker/core/access/resource_types';
import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import type { ResourceGrantRow } from '@coworker/core/db/queries/resource_grants';
import { brain_items } from '@coworker/core/db/schema';
import { merge_metadata, updated_by } from '@coworker/core/db/schema/common';
import { resource_grants } from '@coworker/core/db/schema/projects';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';

export type MemoryScopeMember = {
  grantee_type: GranteeType;
  grantee_id: string;
  member_kind: 'member' | 'guest';
};

export type ReplaceMemoryScopeMembersForSweepInput = {
  workspace_id: string;
  scope_key: string;
  sweep_id: string;
  swept_time: Date;
  members: readonly MemoryScopeMember[];
  actor_id: string;
};

export type MemoryScopeSweepResult =
  | { outcome: 'swept'; rows: ResourceGrantRow[] }
  | { outcome: 'superseded_by_newer_sweep'; newest_swept_time: string }
  | { outcome: 'scope_item_not_found' };

type ScopeRef = { workspace_id: string; scope_key: string };

const sweep_owned_row = sql`${resource_grants.metadata} ? 'sweep_id'`;
const row_swept_time = sql`coalesce((${resource_grants.metadata} ->> 'swept_time')::timestamptz, '-infinity'::timestamptz)`;

/**
 * Writes a memory scope's reader list from one sweep (a provider member sync). The scope's brain
 * item carries a `last_member_sweep_time` watermark in its metadata (merged on write, never
 * replaced), read with `SELECT ... FOR UPDATE` and set in the same transaction as the grant
 * writes, so an empty sweep still records its time and a late, out-of-order sweep cannot re-grant
 * a member a newer sweep removed. A sweep older than the stored watermark returns
 * `superseded_by_newer_sweep` and writes nothing. A scope with no brain item fails closed with
 * `scope_item_not_found` and writes nothing. Otherwise it deletes sweep rows strictly older than
 * `swept_time` and upserts its members. A row with no `sweep_id` is an admin's own grant: the
 * sweep never updates, downgrades, or deletes it, and leaves it out of the returned rows.
 */
export async function replace_memory_scope_members_for_sweep(
  db: Database,
  input: ReplaceMemoryScopeMembersForSweepInput,
): Promise<MemoryScopeSweepResult> {
  return db.transaction(async (tx) => {
    const scope_item = await lock_scope_item_for_sweep(tx, input);
    if (!scope_item) return { outcome: 'scope_item_not_found' };

    const newest_swept_time = read_last_member_sweep_time(scope_item.metadata);
    if (newest_swept_time && newest_swept_time > input.swept_time.toISOString()) {
      return { outcome: 'superseded_by_newer_sweep', newest_swept_time };
    }

    await record_member_sweep_watermark(tx, scope_item.brain_item_id, input);
    await delete_rows_from_an_older_sweep(tx, input);
    return { outcome: 'swept', rows: await upsert_sweep_members(tx, input) };
  });
}

function rows_in_scope(input: ScopeRef): SQL[] {
  return [
    eq(resource_grants.workspace_id, input.workspace_id),
    eq(resource_grants.resource_type, memory_scope_resource_type),
    eq(resource_grants.resource_id, input.scope_key),
  ];
}

function swept_time_param(swept_time: Date): SQL {
  return sql`${swept_time.toISOString()}::timestamptz`;
}

type ScopeItemRow = { brain_item_id: string; metadata: Record<string, unknown> };

async function lock_scope_item_for_sweep(
  tx: DatabaseExecutor,
  input: ScopeRef,
): Promise<ScopeItemRow | null> {
  const [row] = await tx
    .select({ brain_item_id: brain_items.brain_item_id, metadata: brain_items.metadata })
    .from(brain_items)
    .where(
      and(
        eq(brain_items.workspace_id, input.workspace_id),
        eq(brain_items.item_kind, 'scope'),
        eq(brain_items.scope_key, input.scope_key),
        isNull(brain_items.deleted_time),
      ),
    )
    .for('update');
  return row ?? null;
}

function read_last_member_sweep_time(metadata: Record<string, unknown>): string | null {
  const value = metadata.last_member_sweep_time;
  return typeof value === 'string' ? value : null;
}

async function record_member_sweep_watermark(
  tx: DatabaseExecutor,
  brain_item_id: string,
  input: { workspace_id: string; swept_time: Date; actor_id: string },
): Promise<void> {
  await tx
    .update(brain_items)
    .set({
      metadata: merge_metadata(brain_items.metadata, {
        last_member_sweep_time: input.swept_time.toISOString(),
      }),
      ...updated_by(input.actor_id),
    })
    .where(
      and(
        eq(brain_items.workspace_id, input.workspace_id),
        eq(brain_items.brain_item_id, brain_item_id),
      ),
    );
}

async function delete_rows_from_an_older_sweep(
  tx: DatabaseExecutor,
  input: ScopeRef & { swept_time: Date },
): Promise<void> {
  await tx
    .delete(resource_grants)
    .where(
      and(
        ...rows_in_scope(input),
        sweep_owned_row,
        sql`${row_swept_time} < ${swept_time_param(input.swept_time)}`,
      ),
    );
}

async function upsert_sweep_members(
  tx: DatabaseExecutor,
  input: ReplaceMemoryScopeMembersForSweepInput,
): Promise<ResourceGrantRow[]> {
  if (input.members.length === 0) return [];
  const swept_time = input.swept_time.toISOString();

  return tx
    .insert(resource_grants)
    .values(
      input.members.map((member) => ({
        resource_grant_id: create_id(id_prefixes.resource_grant),
        workspace_id: input.workspace_id,
        resource_type: memory_scope_resource_type,
        resource_id: input.scope_key,
        grantee_type: member.grantee_type,
        grantee_id: member.grantee_id,
        grant_level: 'use' as const,
        metadata: { sweep_id: input.sweep_id, swept_time, member_kind: member.member_kind },
        created_by: input.actor_id,
        last_updated_by: input.actor_id,
      })),
    )
    .onConflictDoUpdate({
      target: [
        resource_grants.workspace_id,
        resource_grants.resource_type,
        resource_grants.resource_id,
        resource_grants.grantee_type,
        resource_grants.grantee_id,
      ],
      set: {
        grant_level: 'use',
        metadata: sql`coalesce(${resource_grants.metadata}, '{}'::jsonb) || excluded.metadata`,
        ...updated_by(input.actor_id),
      },
      setWhere: sweep_owned_row,
    })
    .returning();
}
