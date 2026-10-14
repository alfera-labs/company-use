import { create_team_secret } from '@api/services/team/team_secrets';
import type { DatabaseExecutor } from '@coworker/core';
import { create_team_session } from '@coworker/core/db/queries/team_sessions';

export const team_session_lifetime_ms = 30 * 24 * 60 * 60 * 1000;

export type TeamSession = { session_token: string; max_age_seconds: number };

export async function start_team_session(
  db: DatabaseExecutor,
  member: { workspace_id: string; user_id: string },
): Promise<TeamSession> {
  const session = create_team_secret();
  await create_team_session(db, {
    workspace_id: member.workspace_id,
    user_id: member.user_id,
    session_hash: session.secret_hash,
    expires_time: new Date(Date.now() + team_session_lifetime_ms),
  });
  return { session_token: session.secret, max_age_seconds: team_session_lifetime_ms / 1000 };
}
