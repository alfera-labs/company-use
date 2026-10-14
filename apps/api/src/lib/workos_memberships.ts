import { resolve_workos_client } from '@api/lib/workos_client';

export const workos_admin_role_slug = 'admin';
export const workos_member_role_slug = 'member';

export type ActiveMembership = { organization_id: string; role_slug?: string };

export async function list_active_memberships_for_user(
  workos_user_id: string,
): Promise<ActiveMembership[]> {
  const workos = resolve_workos_client();
  if (!workos) return [];
  const memberships = await workos.userManagement.listOrganizationMemberships({
    userId: workos_user_id,
    statuses: ['active'],
    limit: 100,
  });
  return memberships.data.map((membership) => ({
    organization_id: membership.organizationId,
    ...(membership.role?.slug ? { role_slug: membership.role.slug } : {}),
  }));
}

export async function create_admin_member_if_absent(input: {
  organization_id: string;
  workos_user_id: string;
}): Promise<void> {
  const workos = resolve_workos_client();
  if (!workos) return;
  const existing = await workos.userManagement.listOrganizationMemberships({
    organizationId: input.organization_id,
    userId: input.workos_user_id,
    limit: 1,
  });
  if (existing.data.length > 0) return;
  await workos.userManagement.createOrganizationMembership({
    organizationId: input.organization_id,
    userId: input.workos_user_id,
    roleSlug: workos_admin_role_slug,
  });
}

export async function promote_sole_member_to_admin(input: {
  organization_id: string;
  workos_user_id: string;
}): Promise<void> {
  const workos = resolve_workos_client();
  if (!workos) return;
  const active = await workos.userManagement.listOrganizationMemberships({
    organizationId: input.organization_id,
    statuses: ['active'],
    limit: 2,
  });
  const only_member = active.data.length === 1 && active.data[0]?.userId === input.workos_user_id;
  if (!only_member) return;

  const membership = active.data[0];
  if (!membership || membership.role?.slug === workos_admin_role_slug) return;
  await workos.userManagement.updateOrganizationMembership(membership.id, {
    roleSlug: workos_admin_role_slug,
  });
}

export async function set_organization_membership_role(input: {
  organization_id: string;
  workos_user_id: string;
  role_slug: string;
}): Promise<void> {
  const workos = resolve_workos_client();
  if (!workos) return;
  const memberships = await workos.userManagement.listOrganizationMemberships({
    organizationId: input.organization_id,
    userId: input.workos_user_id,
    limit: 1,
  });
  const membership = memberships.data[0];
  if (!membership || membership.role?.slug === input.role_slug) return;
  await workos.userManagement.updateOrganizationMembership(membership.id, {
    roleSlug: input.role_slug,
  });
}
