import type {
  GranteeType,
  GrantLevel,
  StoredGrantRule,
} from '@coworker/core/access/may_use_resource';
import { memory_scope_resource_type } from '@coworker/core/access/resource_types';
import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { resource_grants } from '@coworker/core/db/schema/projects';
import { ConflictError, create_id, id_prefixes } from '@coworker/shared';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

export type ResourceGrantRow = typeof resource_grants.$inferSelect;

export type GrantHolder = { grantee_type: GranteeType; grantee_id: string };

export type SharingEntry = GrantHolder & { grant_level: GrantLevel };

export type ResourceRef = { resource_type: string; resource_id: string };

export function read_grant_rules(rows: readonly ResourceGrantRow[]): StoredGrantRule[] {
  return rows.map((row) => ({
    grantee_type: row.grantee_type,
    grantee_id: row.grantee_id,
    grant_level: row.grant_level as GrantLevel,
  }));
}

export async function list_grants_for_resource(
  db: DatabaseExecutor,
  input: { workspace_id: string } & ResourceRef,
): Promise<ResourceGrantRow[]> {
  return db
    .select()
    .from(resource_grants)
    .where(
      and(
        eq(resource_grants.workspace_id, input.workspace_id),
        eq(resource_grants.resource_type, input.resource_type),
        eq(resource_grants.resource_id, input.resource_id),
      ),
    );
}

export async function list_grants_for_resources(
  db: DatabaseExecutor,
  input: { workspace_id: string; resource_type: string; resource_ids: readonly string[] },
): Promise<Map<string, ResourceGrantRow[]>> {
  const by_resource = new Map<string, ResourceGrantRow[]>();
  if (input.resource_ids.length === 0) return by_resource;

  const rows = await db
    .select()
    .from(resource_grants)
    .where(
      and(
        eq(resource_grants.workspace_id, input.workspace_id),
        eq(resource_grants.resource_type, input.resource_type),
        inArray(resource_grants.resource_id, [...input.resource_ids]),
      ),
    );

  for (const row of rows) {
    const existing = by_resource.get(row.resource_id);
    if (existing) existing.push(row);
    else by_resource.set(row.resource_id, [row]);
  }
  return by_resource;
}

export async function list_grants_for_grantee(
  db: Database,
  input: { workspace_id: string } & GrantHolder & { resource_type?: string },
): Promise<ResourceGrantRow[]> {
  return db
    .select()
    .from(resource_grants)
    .where(
      and(
        eq(resource_grants.workspace_id, input.workspace_id),
        eq(resource_grants.grantee_type, input.grantee_type),
        eq(resource_grants.grantee_id, input.grantee_id),
        ...(input.resource_type
          ? [eq(resource_grants.resource_type, input.resource_type)]
          : [ne(resource_grants.resource_type, memory_scope_resource_type)]),
      ),
    );
}

export type ReplaceSharingInput = {
  workspace_id: string;
  resource_type: string;
  resource_id: string;
  shared_with: readonly SharingEntry[];
  replaces?: readonly SharingEntry[] | undefined;
  actor_id: string;
};

const the_audience_changed_while_you_were_editing =
  'The audience changed while you were editing. Reload to see it.';

export async function replace_resource_sharing(
  db: Database,
  input: ReplaceSharingInput,
): Promise<ResourceGrantRow[]> {
  return db.transaction(async (tx) => {
    // Without this, two concurrent replaces both DELETE nothing (no rows yet), then both INSERT,
    // and the resource ends up with the UNION of two intended sharing lists instead of either one.
    // Same pattern as sessions.ts.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.workspace_id}), hashtext(${`${input.resource_type}:${input.resource_id}`}))`,
    );
    if (input.replaces) {
      await assert_audience_is_unchanged(tx, input, input.replaces);
    }
    await tx
      .delete(resource_grants)
      .where(
        and(
          eq(resource_grants.workspace_id, input.workspace_id),
          eq(resource_grants.resource_type, input.resource_type),
          eq(resource_grants.resource_id, input.resource_id),
        ),
      );

    if (input.shared_with.length === 0) return [];

    return tx
      .insert(resource_grants)
      .values(
        input.shared_with.map((entry) => ({
          resource_grant_id: create_id(id_prefixes.resource_grant),
          workspace_id: input.workspace_id,
          resource_type: input.resource_type,
          resource_id: input.resource_id,
          grantee_type: entry.grantee_type,
          grantee_id: entry.grantee_id,
          grant_level: entry.grant_level,
          created_by: input.actor_id,
          last_updated_by: input.actor_id,
        })),
      )
      .returning();
  });
}

async function assert_audience_is_unchanged(
  tx: DatabaseExecutor,
  resource: { workspace_id: string } & ResourceRef,
  expected: readonly SharingEntry[],
): Promise<void> {
  const current = await list_grants_for_resource(tx, resource);
  if (same_audience(read_grant_rules(current), expected)) return;
  throw new ConflictError(the_audience_changed_while_you_were_editing);
}

function same_audience(left: readonly StoredGrantRule[], right: readonly SharingEntry[]): boolean {
  const key = (entry: StoredGrantRule) =>
    `${entry.grantee_type}:${entry.grantee_id}:${entry.grant_level}`;
  const left_keys = new Set(left.map(key));
  const right_keys = new Set(right.map(key));
  return (
    left_keys.size === right_keys.size && [...left_keys].every((entry) => right_keys.has(entry))
  );
}
