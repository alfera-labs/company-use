import {
  set_organization_membership_role,
  workos_admin_role_slug,
  workos_member_role_slug,
} from '@api/lib/workos_memberships';
import { find_workspace_organization_id } from '@api/services/workspace';
import type { Database } from '@coworker/core';
import {
  count_workspace_administrators,
  find_workspace_member_identity,
  set_workspace_member_role,
} from '@coworker/core/db/queries/workspace_member_roles';
import { ConflictError, is_workspace_administrator_role, NotFoundError } from '@coworker/shared';

const workos_provider_key = 'workos';

export type WorkspaceMemberRole = 'member' | 'admin';

export async function change_workspace_member_role(
  db: Database,
  input: {
    workspace_id: string;
    user_id: string;
    member_role: WorkspaceMemberRole;
    actor_id: string;
  },
): Promise<{ user_id: string; member_role: WorkspaceMemberRole }> {
  const member = await find_workspace_member_identity(db, input);
  if (!member) throw new NotFoundError('Workspace member');

  const is_administrator = is_workspace_administrator_role(member.member_role);
  if (is_administrator && input.member_role === 'member') {
    const administrators = await count_workspace_administrators(db, input.workspace_id);
    if (administrators <= 1) {
      throw new ConflictError(
        'A workspace needs at least one admin. Make someone else an admin first.',
      );
    }
  }

  await set_workspace_member_role(db, { ...input, member_role: input.member_role });
  await move_the_seat_at_the_identity_provider(db, { ...input, member });
  return { user_id: input.user_id, member_role: input.member_role };
}

async function move_the_seat_at_the_identity_provider(
  db: Database,
  input: {
    workspace_id: string;
    member_role: WorkspaceMemberRole;
    member: { external_identity_provider: string | null; external_identity_id: string | null };
  },
): Promise<void> {
  if (input.member.external_identity_provider !== workos_provider_key) return;
  const workos_user_id = input.member.external_identity_id;
  if (!workos_user_id) return;
  const organization_id = await find_workspace_organization_id(db, input.workspace_id);
  if (!organization_id) return;

  await set_organization_membership_role({
    organization_id,
    workos_user_id,
    role_slug: input.member_role === 'admin' ? workos_admin_role_slug : workos_member_role_slug,
  });
}
