import { local_mode_identity } from '@coworker/config/local_mode_switch';
import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { workspace_identity_id } from '@coworker/core/db/queries/workspace_identity';
import { agents, users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

export type TeamActor = { user_id: string; workspace_id: string; agent_id: string };

function is_the_team_workspace() {
  return and(
    eq(workspaces.external_identity_provider, local_mode_identity.provider_key),
    eq(workspaces.external_identity_id, workspace_identity_id(local_mode_identity)),
    eq(workspaces.workspace_status, 'active'),
  );
}

/** Team mode keeps the one workspace local mode made, so this is the same row under both. */
export async function find_team_workspace(db: DatabaseExecutor) {
  const [workspace] = await db
    .select({ workspace_id: workspaces.workspace_id })
    .from(workspaces)
    .where(is_the_team_workspace())
    .limit(1);
  return workspace ?? null;
}

/**
 * Who a signed-in person acts as, or null when they are not an active member. Team mode never
 * makes a person from a request: only an invitation does.
 */
export async function find_team_actor(
  db: DatabaseExecutor,
  input: { user_id: string },
): Promise<TeamActor | null> {
  const [actor] = await db
    .select({
      user_id: users.user_id,
      workspace_id: workspaces.workspace_id,
      agent_id: agents.agent_id,
    })
    .from(users)
    .innerJoin(
      workspace_members,
      and(
        eq(workspace_members.user_id, users.user_id),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .innerJoin(
      workspaces,
      and(eq(workspaces.workspace_id, workspace_members.workspace_id), is_the_team_workspace()),
    )
    .innerJoin(
      agents,
      and(
        eq(agents.workspace_id, workspaces.workspace_id),
        eq(agents.agent_slug, 'main'),
        eq(agents.agent_status, 'active'),
      ),
    )
    .where(and(eq(users.user_id, input.user_id), eq(users.user_status, 'active')))
    .limit(1);
  return actor ?? null;
}

/** The owner a lost-device link is for: the one who has been an owner the longest. */
export async function find_first_team_owner(db: DatabaseExecutor, workspace_id: string) {
  const [owner] = await db
    .select({ user_id: workspace_members.user_id })
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.member_role, 'owner'),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .orderBy(workspace_members.created_time)
    .limit(1);
  return owner ?? null;
}
