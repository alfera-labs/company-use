import type { GranteeType, GrantLevel } from '@coworker/core/access/may_use_resource';
import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { raise_project_name_conflict_or_rethrow } from '@coworker/core/db/queries/projects';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import type { ResourceGrantRow } from '@coworker/core/db/queries/resource_grants';
import { projects, resource_grants } from '@coworker/core/db/schema/projects';
import { ConflictError, create_id, id_prefixes } from '@coworker/shared';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';

const project_resource_type = 'project';

export type ProjectMemberWrite = {
  workspace_id: string;
  project_id: string;
  grantee_type: GranteeType;
  grantee_id: string;
  grant_level: GrantLevel;
  actor_id: string;
};

export async function list_project_members(
  db: DatabaseExecutor,
  input: { workspace_id: string; project_id: string },
): Promise<ResourceGrantRow[]> {
  return db
    .select()
    .from(resource_grants)
    .where(
      and(
        eq(resource_grants.workspace_id, input.workspace_id),
        eq(resource_grants.resource_type, project_resource_type),
        eq(resource_grants.resource_id, input.project_id),
      ),
    );
}

export async function set_project_member(
  db: Database,
  input: ProjectMemberWrite,
): Promise<ResourceGrantRow> {
  try {
    return await db.transaction(async (tx) => {
      await convert_personal_project_to_members(tx, input);
      const row = await write_project_member(tx, input);
      await advance_membership_version(tx, input);
      return row;
    });
  } catch (cause) {
    raise_project_name_conflict_or_rethrow(cause, 'Personal');
  }
}

async function write_project_member(db: DatabaseExecutor, input: ProjectMemberWrite) {
  const [row] = await db
    .insert(resource_grants)
    .values({
      resource_grant_id: create_id(id_prefixes.resource_grant),
      workspace_id: input.workspace_id,
      resource_type: project_resource_type,
      resource_id: input.project_id,
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
  return require_inserted_row(row, 'Project member');
}

async function convert_personal_project_to_members(
  db: DatabaseExecutor,
  input: ProjectMemberWrite,
) {
  const adds_another_person =
    input.grantee_type !== 'user' ? sql`true` : ne(projects.personal_for_user_id, input.grantee_id);
  await db
    .update(projects)
    .set({
      project_access: 'members',
      personal_for_user_id: null,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(projects.workspace_id, input.workspace_id),
        eq(projects.project_id, input.project_id),
        isNotNull(projects.personal_for_user_id),
        adds_another_person,
      ),
    );
}

export async function remove_project_member(
  db: Database,
  input: Omit<ProjectMemberWrite, 'grant_level'>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await refuse_removing_the_last_manager(tx, input);
    await tx
      .delete(resource_grants)
      .where(
        and(
          eq(resource_grants.workspace_id, input.workspace_id),
          eq(resource_grants.resource_type, project_resource_type),
          eq(resource_grants.resource_id, input.project_id),
          eq(resource_grants.grantee_type, input.grantee_type),
          eq(resource_grants.grantee_id, input.grantee_id),
        ),
      );
    await advance_membership_version(tx, input);
  });
}

async function refuse_removing_the_last_manager(
  tx: DatabaseExecutor,
  input: Omit<ProjectMemberWrite, 'grant_level'>,
): Promise<void> {
  if (input.grantee_type !== 'user') return;
  const members = await list_project_members(tx, input);
  const managers = members.filter(
    (member) => member.grantee_type === 'user' && member.grant_level === 'manage',
  );
  if (managers.length === 1 && managers[0]?.grantee_id === input.grantee_id) {
    throw new ConflictError(
      'A project needs at least one manager. Make someone else a manager first.',
    );
  }
}

async function advance_membership_version(
  tx: DatabaseExecutor,
  input: { workspace_id: string; project_id: string; actor_id: string },
): Promise<void> {
  await tx
    .update(projects)
    .set({
      membership_version: sql`${projects.membership_version} + 1`,
      last_updated_by: input.actor_id,
      last_updated_time: new Date(),
    })
    .where(
      and(eq(projects.workspace_id, input.workspace_id), eq(projects.project_id, input.project_id)),
    );
}
