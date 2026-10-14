import type { Database } from '@coworker/core/db/connection';
import { projects } from '@coworker/core/db/schema/projects';
import { and, eq, type SQLWrapper, sql } from 'drizzle-orm';

export function project_is_visible_to_user(
  workspace_id: string,
  user_id: string,
  project_id: SQLWrapper,
) {
  return sql`EXISTS (
    SELECT 1 FROM "projects" AS visible_project
    WHERE visible_project."workspace_id" = ${workspace_id}
      AND visible_project."project_id" = ${project_id}
      AND (
        visible_project."project_access" = 'workspace'
        OR (
          visible_project."project_access" = 'private'
          AND visible_project."personal_for_user_id" = ${user_id}
        )
        OR (
          visible_project."project_access" = 'members'
          AND EXISTS (
            SELECT 1 FROM "resource_grants" AS reader_grant
            WHERE reader_grant."workspace_id" = ${workspace_id}
              AND reader_grant."resource_type" = 'project'
              AND reader_grant."resource_id" = visible_project."project_id"
              AND reader_grant."grantee_type" = 'user'
              AND reader_grant."grantee_id" = ${user_id}
          )
        )
      )
  )`;
}

export async function find_visible_project(
  db: Database,
  input: { workspace_id: string; project_id: string; user_id: string },
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspace_id, input.workspace_id),
        eq(projects.project_id, input.project_id),
        project_is_visible_to_user(input.workspace_id, input.user_id, projects.project_id),
      ),
    )
    .limit(1);
  return project ?? null;
}
