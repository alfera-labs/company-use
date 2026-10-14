import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { team_sessions, users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { and, eq, gt, lte, notLike, sql } from 'drizzle-orm';

type TeamMemberKey = { workspace_id: string; user_id: string };

export async function create_team_session(
  db: DatabaseExecutor,
  input: TeamMemberKey & { session_hash: string; expires_time: Date },
): Promise<void> {
  await db.insert(team_sessions).values({
    session_hash: input.session_hash,
    workspace_id: input.workspace_id,
    user_id: input.user_id,
    expires_time: input.expires_time,
    created_by: input.user_id,
    last_updated_by: input.user_id,
  });
}

export type TeamSessionMember = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

/** The person an unexpired session belongs to, only while that person is an active member. */
export async function find_team_session_member(
  db: DatabaseExecutor,
  session_hash: string,
): Promise<TeamSessionMember | null> {
  const [member] = await db
    .select({
      user_id: users.user_id,
      first_name: users.first_name,
      last_name: users.last_name,
    })
    .from(team_sessions)
    .innerJoin(
      workspaces,
      and(
        eq(workspaces.workspace_id, team_sessions.workspace_id),
        eq(workspaces.workspace_status, 'active'),
      ),
    )
    .innerJoin(
      users,
      and(eq(users.user_id, team_sessions.user_id), eq(users.user_status, 'active')),
    )
    .innerJoin(
      workspace_members,
      and(
        eq(workspace_members.workspace_id, team_sessions.workspace_id),
        eq(workspace_members.user_id, team_sessions.user_id),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .where(
      and(eq(team_sessions.session_hash, session_hash), gt(team_sessions.expires_time, sql`now()`)),
    )
    .limit(1);
  return member ?? null;
}

export async function delete_team_session(db: DatabaseExecutor, session_hash: string) {
  await db.delete(team_sessions).where(eq(team_sessions.session_hash, session_hash));
}

export async function delete_team_sessions_of_member(db: DatabaseExecutor, input: TeamMemberKey) {
  await db
    .delete(team_sessions)
    .where(
      and(
        eq(team_sessions.workspace_id, input.workspace_id),
        eq(team_sessions.user_id, input.user_id),
      ),
    );
}

const removed_member_mark = 'removed:';

/**
 * A removed person is out at once, so none of their rows may sign anybody in again. Each one
 * gets a key no session token hashes to, and stays until the session would have run out. It
 * is kept for one reason: the browser that still holds the token can be told that the person
 * was removed, in place of a page that asks for a sign-in link.
 */
export async function end_team_sessions_of_removed_member(
  db: DatabaseExecutor,
  input: TeamMemberKey & { actor_id: string },
) {
  await db
    .update(team_sessions)
    .set({
      session_hash: sql`${removed_member_mark} || ${team_sessions.session_hash}`,
      ...updated_by(input.actor_id),
    })
    .where(
      and(
        eq(team_sessions.workspace_id, input.workspace_id),
        eq(team_sessions.user_id, input.user_id),
        notLike(team_sessions.session_hash, `${removed_member_mark}%`),
      ),
    );
}

/** The name of the workspace this session's person was removed from, or null for any other session. */
export async function find_workspace_a_session_was_removed_from(
  db: DatabaseExecutor,
  session_hash: string,
): Promise<string | null> {
  const [workspace] = await db
    .select({ workspace_name: workspaces.workspace_name })
    .from(team_sessions)
    .innerJoin(workspaces, eq(workspaces.workspace_id, team_sessions.workspace_id))
    .where(eq(team_sessions.session_hash, `${removed_member_mark}${session_hash}`))
    .limit(1);
  return workspace?.workspace_name ?? null;
}

/** A session past its end signs nobody in, so the periodic sweep removes the row. */
export async function delete_expired_team_sessions(db: DatabaseExecutor): Promise<void> {
  await db.delete(team_sessions).where(lte(team_sessions.expires_time, sql`now()`));
}
