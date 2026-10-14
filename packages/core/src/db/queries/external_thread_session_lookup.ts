import type { Database } from '@coworker/core/db/connection';
import { sessions } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

type ExternalThread = {
  workspace_id: string;
  agent_id: string;
  session_source: string;
  external_thread_key: string;
  actor_id: string;
};

export async function find_session_for_external_thread(db: Database, input: ExternalThread) {
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.agent_id, input.agent_id),
      eq(sessions.session_source, input.session_source),
      eq(sessions.external_thread_key, input.external_thread_key),
    ),
  });
  if (session?.session_status !== 'deleted') return session;

  await db
    .update(sessions)
    .set({
      external_thread_key: null,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(sessions.workspace_id, session.workspace_id),
        eq(sessions.session_id, session.session_id),
      ),
    );
  return undefined;
}
