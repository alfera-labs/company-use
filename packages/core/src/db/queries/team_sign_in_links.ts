import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { team_member_statuses } from '@coworker/core/db/queries/team_members';
import { team_sign_in_links, users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

type TeamMemberKey = { workspace_id: string; user_id: string };

/** A person has one live link at a time: making a new one ends the earlier unused ones. */
export async function create_team_sign_in_link(
  db: DatabaseExecutor,
  input: TeamMemberKey & { token_hash: string; expires_time: Date; actor_id: string },
): Promise<void> {
  await delete_unused_team_sign_in_links(db, input);
  await db.insert(team_sign_in_links).values({
    token_hash: input.token_hash,
    workspace_id: input.workspace_id,
    user_id: input.user_id,
    expires_time: input.expires_time,
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  });
}

export type OpenTeamSignInLink = {
  workspace_id: string;
  workspace_name: string;
  first_name: string | null;
  last_name: string | null;
  member_status: string;
};

/** The link a token hash names, only while it is unused, unexpired and its person still belongs. */
export async function find_open_team_sign_in_link(
  db: DatabaseExecutor,
  token_hash: string,
): Promise<OpenTeamSignInLink | null> {
  const [link] = await db
    .select({
      workspace_id: workspaces.workspace_id,
      workspace_name: workspaces.workspace_name,
      first_name: users.first_name,
      last_name: users.last_name,
      member_status: workspace_members.member_status,
    })
    .from(team_sign_in_links)
    .innerJoin(
      workspaces,
      and(
        eq(workspaces.workspace_id, team_sign_in_links.workspace_id),
        eq(workspaces.workspace_status, 'active'),
      ),
    )
    .innerJoin(
      users,
      and(eq(users.user_id, team_sign_in_links.user_id), eq(users.user_status, 'active')),
    )
    .innerJoin(
      workspace_members,
      and(
        eq(workspace_members.workspace_id, team_sign_in_links.workspace_id),
        eq(workspace_members.user_id, team_sign_in_links.user_id),
        inArray(workspace_members.member_status, [...team_member_statuses]),
      ),
    )
    .where(and(eq(team_sign_in_links.token_hash, token_hash), link_is_open()))
    .limit(1);
  return link ?? null;
}

/**
 * Uses the link up and says whose it was, or null when it is not open any more. One UPDATE
 * decides, so two requests with the same token cannot both win.
 */
export async function use_team_sign_in_link(
  db: DatabaseExecutor,
  token_hash: string,
): Promise<(TeamMemberKey & { made_by: string }) | null> {
  const [link] = await db
    .update(team_sign_in_links)
    .set({ used_time: sql`now()`, ...updated_by(team_sign_in_links.user_id) })
    .where(and(eq(team_sign_in_links.token_hash, token_hash), link_is_open()))
    .returning({
      workspace_id: team_sign_in_links.workspace_id,
      user_id: team_sign_in_links.user_id,
      made_by: team_sign_in_links.created_by,
    });
  return link ?? null;
}

export async function delete_unused_team_sign_in_links(
  db: DatabaseExecutor,
  input: TeamMemberKey,
): Promise<void> {
  await db
    .delete(team_sign_in_links)
    .where(
      and(
        eq(team_sign_in_links.workspace_id, input.workspace_id),
        eq(team_sign_in_links.user_id, input.user_id),
        isNull(team_sign_in_links.used_time),
      ),
    );
}

/** A link that was used or ran out opens nothing, so the periodic sweep removes the row. */
export async function delete_finished_team_sign_in_links(db: DatabaseExecutor): Promise<void> {
  await db
    .delete(team_sign_in_links)
    .where(
      or(isNotNull(team_sign_in_links.used_time), lte(team_sign_in_links.expires_time, sql`now()`)),
    );
}

function link_is_open() {
  return and(isNull(team_sign_in_links.used_time), gt(team_sign_in_links.expires_time, sql`now()`));
}
