import type { Database } from '@coworker/core/db/connection';
import { files } from '@coworker/core/db/schema';
import { NotFoundError } from '@coworker/shared';
import { and, asc, eq, isNull, or } from 'drizzle-orm';

export async function list_project_files(
  db: Database,
  input: { workspace_id: string; project_id: string },
) {
  return db.query.files.findMany({
    where: and(eq(files.workspace_id, input.workspace_id), eq(files.project_id, input.project_id)),
    orderBy: [asc(files.created_time)],
  });
}

export async function attach_project_file(
  db: Database,
  input: { workspace_id: string; project_id: string; file_id: string; actor_id: string },
) {
  const [file] = await db
    .update(files)
    .set({
      project_id: input.project_id,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(files.workspace_id, input.workspace_id),
        eq(files.file_id, input.file_id),
        eq(files.file_status, 'ready'),
        or(isNull(files.project_id), eq(files.project_id, input.project_id)),
      ),
    )
    .returning();
  if (!file) throw new NotFoundError('File');
  return file;
}

export async function detach_project_file(
  db: Database,
  input: { workspace_id: string; project_id: string; file_id: string; actor_id: string },
) {
  const [file] = await db
    .update(files)
    .set({ project_id: null, last_updated_time: new Date(), last_updated_by: input.actor_id })
    .where(
      and(
        eq(files.workspace_id, input.workspace_id),
        eq(files.project_id, input.project_id),
        eq(files.file_id, input.file_id),
      ),
    )
    .returning();
  if (!file) throw new NotFoundError('File');
  return file;
}
