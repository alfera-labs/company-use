import type { Database } from '@coworker/core/db/connection';
import { users, workspace_members } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { workspace_administrator_roles } from '@coworker/shared';
import { and, eq, inArray } from 'drizzle-orm';

export type WorkspaceMemberIdentity = {
  member_role: string;
  external_identity_provider: string | null;
  external_identity_id: string | null;
};

export async function count_workspace_administrators(
  db: Database,
  workspace_id: string,
): Promise<number> {
  const rows = await db
    .select({ user_id: workspace_members.user_id })
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.member_status, 'active'),
        inArray(workspace_members.member_role, [...workspace_administrator_roles]),
      ),
    );
  return rows.length;
}

export async function find_workspace_member_identity(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<WorkspaceMemberIdentity | null> {
  const [row] = await db
    .select({
      member_role: workspace_members.member_role,
      external_identity_provider: users.external_identity_provider,
      external_identity_id: users.external_identity_id,
    })
    .from(workspace_members)
    .innerJoin(users, eq(users.user_id, workspace_members.user_id))
    .where(
      and(
        eq(workspace_members.workspace_id, input.workspace_id),
        eq(workspace_members.user_id, input.user_id),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function set_workspace_member_role(
  db: Database,
  input: { workspace_id: string; user_id: string; member_role: string; actor_id: string },
): Promise<void> {
  await db
    .update(workspace_members)
    .set({ member_role: input.member_role, ...updated_by(input.actor_id) })
    .where(
      and(
        eq(workspace_members.workspace_id, input.workspace_id),
        eq(workspace_members.user_id, input.user_id),
        eq(workspace_members.member_status, 'active'),
      ),
    );
}
