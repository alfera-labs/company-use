import type { PublicSession } from '@api/services/sessions_api/public_session';
import {
  get_api_session,
  project_sessions,
  require_owned_api_session,
} from '@api/services/sessions_api/session_reads';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { archive_session } from '@coworker/core/db/queries/sessions';
import type { sessions } from '@coworker/core/db/schema';
import { AppError } from '@coworker/shared';

type SessionRow = typeof sessions.$inferSelect;

export async function archive_api_session(
  db: Database,
  api_key: ApiKey,
  session_id: string,
): Promise<PublicSession> {
  const session = await require_owned_api_session(db, api_key, session_id);
  await archive_idle_session(db, session, api_key.api_key_id);
  return get_api_session(db, api_key, session_id);
}

export async function archive_idle_session(
  db: Database,
  session: SessionRow,
  actor_id: string,
): Promise<SessionRow> {
  const [current] = await project_sessions(db, session.workspace_id, [session]);
  if (current?.status === 'running') {
    throw new AppError(
      'conversation_busy',
      'This session is running. Interrupt it before archiving.',
      409,
    );
  }
  if (current?.status === 'terminated') return session;
  return archive_session(db, {
    workspace_id: session.workspace_id,
    session_id: session.session_id,
    actor_id,
  });
}
