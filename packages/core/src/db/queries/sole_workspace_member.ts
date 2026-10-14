import type { Database } from '@coworker/core/db/connection';
import { users, workspace_members } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

/** The user id of the only active member of a workspace, or null when it has none or several. */
export async function find_sole_active_workspace_member(db: Database, workspace_id: string) {
  const members = await db
    .select({ user_id: workspace_members.user_id })
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .limit(2);
  return members.length === 1 ? (members[0]?.user_id ?? null) : null;
}
