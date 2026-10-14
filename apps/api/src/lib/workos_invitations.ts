import { resolve_workos_client } from '@api/lib/workos_client';
import { AppError, NotFoundError } from '@coworker/shared';
import type { Invitation } from '@workos-inc/node';

// The invitations WorkOS is holding for a user. An invitation to an organization is NOT a membership
// of it, which is why a pending invite is invisible to list_active_memberships_for_user and has to be
// read here.
//
// WorkOS keeps two records side by side for one invite: the invitation carries the accept URL, and
// the pending organization membership carries the organization's name. Both are read and joined on
// the organization id.

const invitation_page_size = 20;
const unnamed_workspace_label = 'A team workspace';

export type PendingWorkspaceInvitation = {
  invitation_id: string;
  organization_id: string;
  organization_name: string;
  accept_url: string;
};

export async function list_pending_workspace_invitations(
  workos_user_id: string,
): Promise<PendingWorkspaceInvitation[]> {
  const workos = resolve_workos_client();
  if (!workos) return [];

  const { email } = await workos.userManagement.getUser(workos_user_id);
  const [invitation_page, pending_membership_page] = await Promise.all([
    workos.userManagement.listInvitations({ email, limit: invitation_page_size, order: 'desc' }),
    workos.userManagement.listOrganizationMemberships({
      userId: workos_user_id,
      statuses: ['pending'],
      limit: invitation_page_size,
    }),
  ]);

  const workspace_names = new Map(
    pending_membership_page.data.map((membership) => [
      membership.organizationId,
      membership.organizationName,
    ]),
  );
  // WorkOS has no server-side state filter on listInvitations, so accepted, revoked, and expired
  // records share the page with live ones and are dropped here.
  return invitation_page.data.flatMap((invitation) => {
    if (invitation.state !== 'pending' || !invitation.organizationId) return [];
    return [
      {
        invitation_id: invitation.id,
        organization_id: invitation.organizationId,
        organization_name:
          workspace_names.get(invitation.organizationId) ?? unnamed_workspace_label,
        accept_url: invitation.acceptInvitationUrl,
      },
    ];
  });
}

// One page. A team sitting on more than 100 unanswered invitations wants a different
// screen than a settings panel.
const team_invitation_page_size = 100;

export type TeamInvitation = {
  invitation_id: string;
  email: string;
  role_slug?: string;
  created_time: string;
};

export async function list_team_invitations(organization_id: string): Promise<TeamInvitation[]> {
  const workos = resolve_workos_client();
  if (!workos) return [];
  const page = await workos.userManagement.listInvitations({
    organizationId: organization_id,
    limit: team_invitation_page_size,
    order: 'desc',
  });
  // Same as above: listInvitations has no server-side state filter, so settled records share the
  // page with live ones.
  return page.data.filter((invitation) => invitation.state === 'pending').map(team_invitation_of);
}

export async function send_team_invitation(input: {
  organization_id: string;
  email: string;
  role_slug: string;
}): Promise<TeamInvitation> {
  const invitation = await workos_user_management().sendInvitation({
    email: input.email,
    organizationId: input.organization_id,
    roleSlug: input.role_slug,
  });
  return team_invitation_of(invitation);
}

// The invitation id comes from the browser, and WorkOS would revoke any id the API key can reach —
// including another workspace's. The organization is read back from WorkOS and compared first, so a
// workspace can only withdraw its own invitations.
export async function revoke_team_invitation(input: {
  organization_id: string;
  invitation_id: string;
}): Promise<void> {
  const user_management = workos_user_management();
  const invitation = await user_management.getInvitation(input.invitation_id);
  if (invitation.organizationId !== input.organization_id) {
    throw new NotFoundError('Invitation');
  }
  await user_management.revokeInvitation(input.invitation_id);
}

export function workos_environment_required() {
  return new AppError(
    'workos_environment_required',
    'Team invitations need a WorkOS environment.',
    409,
  );
}

function workos_user_management() {
  const workos = resolve_workos_client();
  if (!workos) throw workos_environment_required();
  return workos.userManagement;
}

function team_invitation_of(invitation: Invitation): TeamInvitation {
  return {
    invitation_id: invitation.id,
    email: invitation.email,
    ...(invitation.roleSlug ? { role_slug: invitation.roleSlug } : {}),
    created_time: invitation.createdAt,
  };
}
