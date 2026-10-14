import type { Database } from '@coworker/core/db/connection';
import { sessions } from '@coworker/core/db/schema';
import { NotFoundError } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

export async function move_session_to_project(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    project_id: string | null;
    actor_id: string;
  },
) {
  const [session] = await db
    .update(sessions)
    .set({
      project_id: input.project_id,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    )
    .returning();
  if (!session) throw new NotFoundError('Session');
  return session;
}
