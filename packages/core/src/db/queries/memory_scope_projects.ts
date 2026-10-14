import type { Database } from '@coworker/core/db/connection';
import type { ProjectRow } from '@coworker/core/db/queries/projects';
import { projects } from '@coworker/core/db/schema/projects';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

type ProjectMemoryFlags = Pick<ProjectRow, 'is_workspace_default' | 'personal_for_user_id'>;

/** A project has its own memory scope unless it is the workspace default or someone's Personal room. */
export function project_has_own_memory_scope(project: ProjectMemoryFlags): boolean {
  return !project.is_workspace_default && project.personal_for_user_id === null;
}

export async function list_projects_without_own_memory_scope(
  db: Database,
  input: { workspace_id: string; project_ids: readonly string[] },
): Promise<Set<string>> {
  if (input.project_ids.length === 0) return new Set();
  const rows = await db
    .select({ project_id: projects.project_id })
    .from(projects)
    .where(
      and(
        eq(projects.workspace_id, input.workspace_id),
        inArray(projects.project_id, [...input.project_ids]),
        or(eq(projects.is_workspace_default, true), isNotNull(projects.personal_for_user_id)),
      ),
    );
  return new Set(rows.map((row) => row.project_id));
}
