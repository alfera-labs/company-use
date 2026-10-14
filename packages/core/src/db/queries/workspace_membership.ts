import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import {
  organization_id_from_external_identity,
  system_actor_for_identity,
} from '@coworker/core/db/queries/workspace_identity';
import { users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { and, desc, eq, sql } from 'drizzle-orm';

const organization_external_id_prefix = 'organization:';

export type WorkspaceSummary = {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  organization_id: string;
  member_role: string;
};

const last_active_key = 'last_active_organization_id';

export async function list_workspaces_for_user(
  db: Database,
  user_id: string,
): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({
      workspace_id: workspaces.workspace_id,
      workspace_name: workspaces.workspace_name,
      workspace_slug: workspaces.workspace_slug,
      external_identity_provider: workspaces.external_identity_provider,
      external_identity_id: workspaces.external_identity_id,
      member_role: workspace_members.member_role,
    })
    .from(workspace_members)
    .innerJoin(
      workspaces,
      and(
        eq(workspaces.workspace_id, workspace_members.workspace_id),
        eq(workspaces.workspace_status, 'active'),
      ),
    )
    .where(
      and(eq(workspace_members.user_id, user_id), eq(workspace_members.member_status, 'active')),
    )
    .orderBy(desc(workspace_members.created_time));

  return rows.flatMap((row) => {
    const organization_id = organization_id_from_external_identity(
      row.external_identity_provider,
      row.external_identity_id,
    );
    if (!organization_id) return [];
    return [
      {
        workspace_id: row.workspace_id,
        workspace_name: row.workspace_name,
        workspace_slug: row.workspace_slug,
        organization_id,
        member_role: row.member_role,
      } satisfies WorkspaceSummary,
    ];
  });
}

export async function list_workspace_member_users(db: Database, workspace_id: string) {
  return db
    .select({
      user_id: users.user_id,
      email: users.email,
      first_name: users.first_name,
      last_name: users.last_name,
      member_role: workspace_members.member_role,
    })
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
    .orderBy(users.email);
}

export async function workspace_member_is_active(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  const [member] = await db
    .select({ user_id: workspace_members.user_id })
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(
      and(
        eq(workspace_members.workspace_id, input.workspace_id),
        eq(workspace_members.user_id, input.user_id),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .limit(1);

  return member !== undefined;
}

export async function find_active_workspace_member_role(
  db: DatabaseExecutor,
  input: { workspace_id: string; user_id: string },
) {
  const [member] = await db
    .select({ member_role: workspace_members.member_role })
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, input.workspace_id),
        eq(workspace_members.user_id, input.user_id),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .limit(1);

  return member?.member_role ?? null;
}

export async function deactivate_workspace_member(
  db: Database,
  input: { provider_key: string; organization_id: string; provider_user_id: string },
): Promise<void> {
  const external_identity_id = `${organization_external_id_prefix}${input.organization_id}`;
  const [workspace] = await db
    .select({ workspace_id: workspaces.workspace_id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.external_identity_provider, input.provider_key),
        eq(workspaces.external_identity_id, external_identity_id),
      ),
    )
    .limit(1);
  if (!workspace) return;

  const [user] = await db
    .select({ user_id: users.user_id })
    .from(users)
    .where(
      and(
        eq(users.external_identity_provider, input.provider_key),
        eq(users.external_identity_id, input.provider_user_id),
      ),
    )
    .limit(1);
  if (!user) return;

  await db
    .update(workspace_members)
    .set({ member_status: 'inactive', ...updated_by(system_actor_for_identity(input)) })
    .where(
      and(
        eq(workspace_members.workspace_id, workspace.workspace_id),
        eq(workspace_members.user_id, user.user_id),
      ),
    );
}

export async function set_last_active_organization(
  db: Database,
  input: { provider_key: string; provider_user_id: string; organization_id: string },
): Promise<void> {
  await db
    .update(users)
    .set({
      user_data: sql`${users.user_data} || ${JSON.stringify({ [last_active_key]: input.organization_id })}::jsonb`,
      ...updated_by(users.user_id),
    })
    .where(
      and(
        eq(users.external_identity_provider, input.provider_key),
        eq(users.external_identity_id, input.provider_user_id),
      ),
    );
}

export async function read_last_active_organization(
  db: Database,
  input: { provider_key: string; provider_user_id: string },
): Promise<string | null> {
  const [row] = await db
    .select({ user_data: users.user_data })
    .from(users)
    .where(
      and(
        eq(users.external_identity_provider, input.provider_key),
        eq(users.external_identity_id, input.provider_user_id),
      ),
    )
    .limit(1);

  const value = (row?.user_data as Record<string, unknown> | undefined)?.[last_active_key];
  return typeof value === 'string' && value ? value : null;
}
