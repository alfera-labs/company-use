import type { Database } from '@coworker/core/db/connection';
import { create_project, type ProjectRow } from '@coworker/core/db/queries/projects';
import { workspace_members, workspaces } from '@coworker/core/db/schema';
import { projects } from '@coworker/core/db/schema/projects';
import { ConflictError } from '@coworker/shared';
import { and, eq, isNull } from 'drizzle-orm';

const personal_project_name = 'Personal';

export async function find_personal_project(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<ProjectRow | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspace_id, input.workspace_id),
        eq(projects.personal_for_user_id, input.user_id),
      ),
    )
    .limit(1);
  return project ?? null;
}

export async function open_personal_project(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<ProjectRow> {
  const existing = await find_personal_project(db, input);
  if (existing) return existing;

  try {
    return await create_project(db, {
      workspace_id: input.workspace_id,
      project_name: personal_project_name,
      project_access: 'private',
      personal_for_user_id: input.user_id,
      actor_id: input.user_id,
      owner_id: input.user_id,
    });
  } catch (cause) {
    return read_room_opened_by_the_other_request(db, input, cause);
  }
}

export async function list_members_without_a_personal_room(
  db: Database,
): Promise<{ workspace_id: string; user_id: string }[]> {
  return db
    .select({
      workspace_id: workspace_members.workspace_id,
      user_id: workspace_members.user_id,
    })
    .from(workspace_members)
    .innerJoin(
      workspaces,
      and(
        eq(workspaces.workspace_id, workspace_members.workspace_id),
        eq(workspaces.workspace_status, 'active'),
      ),
    )
    .leftJoin(
      projects,
      and(
        eq(projects.workspace_id, workspace_members.workspace_id),
        eq(projects.personal_for_user_id, workspace_members.user_id),
      ),
    )
    .where(and(eq(workspace_members.member_status, 'active'), isNull(projects.project_id)));
}

function read_room_opened_by_the_other_request(
  db: Database,
  input: { workspace_id: string; user_id: string },
  cause: unknown,
): Promise<ProjectRow> {
  if (!(cause instanceof ConflictError)) throw cause;
  return find_personal_project(db, input).then((project) => {
    if (!project) throw cause;
    return project;
  });
}
