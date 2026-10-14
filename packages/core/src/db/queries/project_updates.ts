import type { Database } from '@coworker/core/db/connection';
import {
  find_project,
  type ProjectRow,
  raise_project_name_conflict_or_rethrow,
} from '@coworker/core/db/queries/projects';
import { projects } from '@coworker/core/db/schema/projects';
import { ConflictError, NotFoundError } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

export type UpdateProjectInput = {
  workspace_id: string;
  project_id: string;
  project_name?: string;
  project_status?: string;
  project_description?: string | null;
  project_instructions?: string | null;
  actor_id: string;
};

export async function update_project(db: Database, input: UpdateProjectInput): Promise<ProjectRow> {
  const current = await find_project(db, input);
  if (!current) throw new NotFoundError('Project');
  if (
    current.personal_for_user_id &&
    (input.project_name !== undefined || input.project_status !== undefined)
  ) {
    throw new ConflictError('A personal room cannot be renamed or archived.');
  }
  if (current.is_workspace_default && input.project_status !== undefined) {
    throw new ConflictError('The default project cannot be archived.');
  }

  const [row] = await update_project_row(db, input).catch((cause) =>
    raise_project_name_conflict_or_rethrow(cause, input.project_name ?? ''),
  );
  if (!row) throw new NotFoundError('Project');
  return row;
}

function update_project_row(db: Database, input: UpdateProjectInput) {
  return db
    .update(projects)
    .set({
      ...(input.project_name === undefined ? {} : { project_name: input.project_name }),
      ...(input.project_status === undefined ? {} : { project_status: input.project_status }),
      ...(input.project_description === undefined
        ? {}
        : { project_description: input.project_description }),
      ...(input.project_instructions === undefined
        ? {}
        : { project_instructions: input.project_instructions }),
      last_updated_by: input.actor_id,
      last_updated_time: new Date(),
    })
    .where(
      and(eq(projects.workspace_id, input.workspace_id), eq(projects.project_id, input.project_id)),
    )
    .returning();
}
