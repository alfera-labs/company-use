import type { Database } from '@coworker/core/db/connection';
import { sessions } from '@coworker/core/db/schema';
import { NotFoundError } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

/** Writes the title a person typed. A title a person wrote is never replaced by a generated one. */
export async function rename_session(
  db: Database,
  input: { workspace_id: string; session_id: string; session_title: string; actor_id: string },
) {
  const [session] = await db
    .update(sessions)
    .set({
      session_title: input.session_title,
      session_metadata: sql`jsonb_set(
        ${sessions.session_metadata},
        '{title_generation}',
        '{"source":"user"}'::jsonb,
        true
      )`,
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
