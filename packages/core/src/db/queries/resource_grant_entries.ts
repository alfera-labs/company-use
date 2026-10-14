import { read_resource_type_definition } from '@coworker/core/access/resource_types';
import type { Database } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import type {
  GrantHolder,
  ResourceGrantRow,
  ResourceRef,
  SharingEntry,
} from '@coworker/core/db/queries/resource_grants';
import { resource_grants } from '@coworker/core/db/schema/projects';
import { ConflictError, create_id, id_prefixes } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

export type ResourceGrantWrite = { workspace_id: string } & ResourceRef &
  SharingEntry & { actor_id: string };

export type ResourceGrantRemoval = { workspace_id: string } & ResourceRef & GrantHolder;

export async function add_resource_grant(
  db: Database,
  input: ResourceGrantWrite,
): Promise<ResourceGrantRow> {
  const [row] = await db
    .insert(resource_grants)
    .values({
      resource_grant_id: create_id(id_prefixes.resource_grant),
      workspace_id: input.workspace_id,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      grantee_type: input.grantee_type,
      grantee_id: input.grantee_id,
      grant_level: input.grant_level,
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoUpdate({
      target: [
        resource_grants.workspace_id,
        resource_grants.resource_type,
        resource_grants.resource_id,
        resource_grants.grantee_type,
        resource_grants.grantee_id,
      ],
      set: {
        grant_level: input.grant_level,
        last_updated_by: input.actor_id,
        last_updated_time: new Date(),
      },
    })
    .returning();
  return require_inserted_row(row, 'Resource grant');
}

const removing_the_last_entry_opens_it_to_everyone =
  'Removing the last entry would open this to everyone. ' +
  'Set the audience to Everyone explicitly instead.';

export async function remove_resource_grant(
  db: Database,
  input: ResourceGrantRemoval,
): Promise<void> {
  const widening_is_possible =
    read_resource_type_definition(input.resource_type).default_access ===
    'everyone_in_the_workspace';

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.workspace_id}), hashtext(${`${input.resource_type}:${input.resource_id}`}))`,
    );
    const rows = await tx
      .select({
        grantee_type: resource_grants.grantee_type,
        grantee_id: resource_grants.grantee_id,
      })
      .from(resource_grants)
      .where(
        and(
          eq(resource_grants.workspace_id, input.workspace_id),
          eq(resource_grants.resource_type, input.resource_type),
          eq(resource_grants.resource_id, input.resource_id),
        ),
      );
    const removes_a_row = rows.some(
      (row) => row.grantee_type === input.grantee_type && row.grantee_id === input.grantee_id,
    );
    if (widening_is_possible && removes_a_row && rows.length === 1) {
      throw new ConflictError(removing_the_last_entry_opens_it_to_everyone);
    }

    await tx
      .delete(resource_grants)
      .where(
        and(
          eq(resource_grants.workspace_id, input.workspace_id),
          eq(resource_grants.resource_type, input.resource_type),
          eq(resource_grants.resource_id, input.resource_id),
          eq(resource_grants.grantee_type, input.grantee_type),
          eq(resource_grants.grantee_id, input.grantee_id),
        ),
      );
  });
}
