import type { GranteeType } from '@coworker/core/access/may_use_resource';
import type { Database } from '@coworker/core/db/connection';
import { project_is_visible_to_user } from '@coworker/core/db/queries/project_visibility';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { projects, resource_grants } from '@coworker/core/db/schema/projects';
import { ConflictError, create_id, id_prefixes } from '@coworker/shared';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';

export type ProjectRow = typeof projects.$inferSelect;

const project_resource_type = 'project';

export function raise_project_name_conflict_or_rethrow(
  cause: unknown,
  project_name: string,
): never {
  if (String((cause as { cause?: { code?: string } })?.cause?.code) === '23505') {
    throw new ConflictError(
      `A project called "${project_name}" already exists in this workspace, possibly one you are not a member of. Pick a different name.`,
    );
  }
  throw cause;
}

export type CreateProjectInput = {
  workspace_id: string;
  project_name: string;
  actor_id: string;
  owner_id: string;
  project_access?: 'private' | 'members' | 'workspace';
  is_workspace_default?: boolean;
  project_description?: string | null;
  project_instructions?: string | null;
  personal_for_user_id?: string;
};

export async function create_project(db: Database, input: CreateProjectInput): Promise<ProjectRow> {
  try {
    return await create_project_in_transaction(db, input);
  } catch (cause) {
    raise_project_name_conflict_or_rethrow(cause, input.project_name);
  }
}

async function create_project_in_transaction(
  db: Database,
  input: CreateProjectInput,
): Promise<ProjectRow> {
  return db.transaction(async (tx) => {
    const [inserted_project] = await tx
      .insert(projects)
      .values({
        project_id: create_id(id_prefixes.project),
        workspace_id: input.workspace_id,
        project_name: input.project_name,
        project_access: input.project_access ?? 'members',
        is_workspace_default: input.is_workspace_default ?? false,
        project_description: input.project_description ?? null,
        project_instructions: input.project_instructions ?? null,
        personal_for_user_id: input.personal_for_user_id ?? null,
        created_by: input.actor_id,
        last_updated_by: input.actor_id,
      })
      .returning();
    const project = require_inserted_row(inserted_project, 'Project');

    await tx.insert(resource_grants).values({
      resource_grant_id: create_id(id_prefixes.resource_grant),
      workspace_id: input.workspace_id,
      resource_type: project_resource_type,
      resource_id: project.project_id,
      grantee_type: 'user',
      grantee_id: input.owner_id,
      grant_level: 'manage',
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    });

    return project;
  });
}

export async function find_project(
  db: Database,
  input: { workspace_id: string; project_id: string },
): Promise<ProjectRow | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.workspace_id, input.workspace_id), eq(projects.project_id, input.project_id)),
    )
    .limit(1);
  return project ?? null;
}

export async function list_projects(
  db: Database,
  input: {
    workspace_id: string;
    project_status?: string;
    query?: string;
    limit?: number;
    visible_to_user_id?: string;
  },
): Promise<ProjectRow[]> {
  return db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspace_id, input.workspace_id),
        eq(projects.project_status, input.project_status ?? 'active'),
        ...(input.query ? [ilike(projects.project_name, `%${input.query}%`)] : []),
        ...(input.visible_to_user_id
          ? [
              project_is_visible_to_user(
                input.workspace_id,
                input.visible_to_user_id,
                projects.project_id,
              ),
            ]
          : []),
      ),
    )
    .orderBy(asc(sql`lower(${projects.project_name})`))
    .limit(input.limit ?? 50);
}

export async function list_projects_for_grantee(
  db: Database,
  input: { workspace_id: string; grantee_type: GranteeType; grantee_id: string },
): Promise<ProjectRow[]> {
  return db
    .select({ project: projects })
    .from(resource_grants)
    .innerJoin(projects, eq(projects.project_id, resource_grants.resource_id))
    .where(
      and(
        eq(resource_grants.workspace_id, input.workspace_id),
        eq(resource_grants.resource_type, project_resource_type),
        eq(resource_grants.grantee_type, input.grantee_type),
        eq(resource_grants.grantee_id, input.grantee_id),
        eq(projects.workspace_id, input.workspace_id),
        eq(projects.project_status, 'active'),
      ),
    )
    .orderBy(asc(sql`lower(${projects.project_name})`))
    .then((rows) => rows.map((row) => row.project));
}
