import type { Database } from '@coworker/core/db/connection';
import { create_project, type ProjectRow } from '@coworker/core/db/queries/projects';
import { projects } from '@coworker/core/db/schema/projects';
import { ConflictError } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

const workspace_project_name = 'Workspace';

export async function find_workspace_project(
  db: Database,
  workspace_id: string,
): Promise<ProjectRow | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspace_id, workspace_id), eq(projects.is_workspace_default, true)))
    .limit(1);
  return project ?? null;
}

export async function open_workspace_project(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<ProjectRow> {
  const existing = await find_workspace_project(db, input.workspace_id);
  if (existing) return existing;

  try {
    return await create_project(db, {
      workspace_id: input.workspace_id,
      project_name: workspace_project_name,
      project_access: 'workspace',
      is_workspace_default: true,
      actor_id: input.user_id,
      owner_id: input.user_id,
    });
  } catch (cause) {
    if (!(cause instanceof ConflictError)) throw cause;
    const project = await find_workspace_project(db, input.workspace_id);
    if (!project) throw cause;
    return project;
  }
}
