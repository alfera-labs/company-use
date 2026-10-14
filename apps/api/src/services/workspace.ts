import {
  list_pending_workspace_invitations,
  type PendingWorkspaceInvitation,
} from '@api/lib/workos_invitations';
import {
  type ActiveMembership,
  create_admin_member_if_absent,
  list_active_memberships_for_user,
  promote_sole_member_to_admin,
  workos_admin_role_slug,
} from '@api/lib/workos_memberships';
import {
  create_workos_organization,
  find_workos_organization_by_external_id,
  update_workos_organization_name,
  type WorkosOrganizationRecord,
} from '@api/lib/workos_organizations';
import { get_workos_user, type WorkosUserProfile } from '@api/lib/workos_users';
import { capture_product_event } from '@api/services/product_events';
import { provision_workspace_volume } from '@api/services/provisioning/workspace_volume_provisioning';
import type { Database } from '@coworker/core';
import {
  organization_id_from_external_identity,
  type WorkspaceIdentity,
} from '@coworker/core/db/queries/workspace_identity';
import type { WorkspaceSummary } from '@coworker/core/db/queries/workspace_membership';
import {
  deactivate_workspace_member,
  list_workspaces_for_user,
  read_last_active_organization,
  set_last_active_organization,
} from '@coworker/core/db/queries/workspace_membership';
import type {
  ProvisionedWorkspace,
  WorkspaceProfile,
} from '@coworker/core/db/queries/workspace_provisioning';
import {
  find_workspace_external_identity,
  find_workspace_profile,
  provision_workspace_for_identity,
  rename_workspace as rename_workspace_row,
} from '@coworker/core/db/queries/workspace_provisioning';
import { AppError, create_logger } from '@coworker/shared';

const log = create_logger('workspace');
const workos_provider_key = 'workos';
const personal_organization_external_id_prefix = 'alfera-workspace-user:';

export type WorkspaceServiceDeps = {
  update_workos_organization_name: (organization_id: string, name: string) => Promise<void>;
  create_workos_organization: (input: {
    name: string;
    external_id?: string;
    workos_user_id: string;
  }) => Promise<WorkosOrganizationRecord | null>;
  find_workos_organization_by_external_id: (
    external_id: string,
  ) => Promise<WorkosOrganizationRecord | null>;
  list_active_memberships_for_user: (workos_user_id: string) => Promise<ActiveMembership[]>;
  create_admin_member_if_absent: (input: {
    organization_id: string;
    workos_user_id: string;
  }) => Promise<void>;
  promote_sole_member_to_admin: (input: {
    organization_id: string;
    workos_user_id: string;
  }) => Promise<void>;
  get_workos_user: (workos_user_id: string) => Promise<WorkosUserProfile | null>;
  list_pending_workspace_invitations: (
    workos_user_id: string,
  ) => Promise<PendingWorkspaceInvitation[]>;
};

const default_deps: WorkspaceServiceDeps = {
  update_workos_organization_name,
  create_workos_organization,
  find_workos_organization_by_external_id,
  list_active_memberships_for_user,
  create_admin_member_if_absent,
  promote_sole_member_to_admin,
  get_workos_user,
  list_pending_workspace_invitations,
};

export async function list_user_workspaces(
  db: Database,
  user_id: string,
): Promise<WorkspaceSummary[]> {
  return list_workspaces_for_user(db, user_id);
}

export async function find_workspace_organization_id(
  db: Database,
  workspace_id: string,
): Promise<string | null> {
  const identity = await find_workspace_external_identity(db, workspace_id);
  if (!identity) return null;
  return organization_id_from_external_identity(
    identity.external_identity_provider,
    identity.external_identity_id,
  );
}

export type RenameWorkspaceDeps = Pick<WorkspaceServiceDeps, 'update_workos_organization_name'>;

export async function rename_workspace(
  db: Database,
  input: { workspace_id: string; workspace_name: string; actor_id: string },
  deps: RenameWorkspaceDeps = default_deps,
): Promise<WorkspaceProfile | null> {
  const profile = await rename_workspace_row(db, input);
  if (!profile) return null;
  await sync_workspace_name_to_workos(db, input.workspace_id, input.workspace_name, deps);
  return profile;
}

async function sync_workspace_name_to_workos(
  db: Database,
  workspace_id: string,
  workspace_name: string,
  deps: RenameWorkspaceDeps,
) {
  const organization_id = await find_workspace_organization_id(db, workspace_id);
  if (!organization_id) return;
  try {
    await deps.update_workos_organization_name(organization_id, workspace_name);
  } catch (error) {
    log.error('WorkOS org name sync failed', { workspace_id, organization_id, error });
  }
}

export type ResolvedOrganization = { organization_id: string; organization_name?: string };

export async function resolve_default_organization(
  db: Database,
  identity: WorkspaceIdentity,
  deps: WorkspaceServiceDeps = default_deps,
): Promise<ResolvedOrganization> {
  const workos_user_id = identity.provider_user_id;
  const [remembered, memberships] = await Promise.all([
    read_last_active_organization(db, {
      provider_key: workos_provider_key,
      provider_user_id: workos_user_id,
    }),
    deps.list_active_memberships_for_user(workos_user_id),
  ]);

  const is_member = (organization_id: string) =>
    memberships.some((membership) => membership.organization_id === organization_id);
  if (remembered && is_member(remembered)) return { organization_id: remembered };

  const default_membership =
    memberships.find((membership) => membership.role_slug === workos_admin_role_slug) ??
    memberships[0];
  if (default_membership) return { organization_id: default_membership.organization_id };

  const invitations = await deps.list_pending_workspace_invitations(workos_user_id);
  if (invitations.length > 0) {
    throw new AppError('pending_invitation', 'Answer your workspace invitation first', 409);
  }
  return resolve_personal_organization(identity, deps);
}

export async function list_workspace_invitations_to_offer(
  identity: WorkspaceIdentity,
  deps: WorkspaceServiceDeps = default_deps,
): Promise<PendingWorkspaceInvitation[]> {
  const workos_user_id = identity.provider_user_id;
  const memberships = await deps.list_active_memberships_for_user(workos_user_id);
  if (memberships.length > 0) return [];
  return deps.list_pending_workspace_invitations(workos_user_id);
}

export type AuthenticatedWorkspace = Omit<
  ProvisionedWorkspace,
  'workspace_was_created' | 'user_was_created'
> &
  ResolvedOrganization;

export async function provision_workspace_for_authenticated_user(
  db: Database,
  identity: WorkspaceIdentity,
  deps: WorkspaceServiceDeps = default_deps,
): Promise<AuthenticatedWorkspace> {
  const organization: ResolvedOrganization = identity.organization_id
    ? { organization_id: identity.organization_id }
    : await resolve_default_organization(db, identity, deps);

  return enter_workspace(db, identity, organization, deps);
}

export async function provision_personal_workspace(
  db: Database,
  identity: WorkspaceIdentity,
  deps: WorkspaceServiceDeps = default_deps,
): Promise<AuthenticatedWorkspace> {
  const organization = await resolve_personal_organization(identity, deps);
  return enter_workspace(db, identity, organization, deps);
}

export type CreatedWorkspace = { organization_id: string; workspace: WorkspaceProfile | null };

export async function create_user_workspace(
  db: Database,
  input: { identity: WorkspaceIdentity; name: string },
  deps: WorkspaceServiceDeps = default_deps,
): Promise<CreatedWorkspace> {
  const workos_user_id = input.identity.provider_user_id;
  const organization = await deps.create_workos_organization({
    name: input.name.trim() || organization_name_from_identity(input.identity),
    workos_user_id,
  });
  if (!organization) throw new Error('WORKOS_API_KEY is required to create a workspace');

  await deps.create_admin_member_if_absent({ organization_id: organization.id, workos_user_id });
  const actor = await provision_workspace_for_identity(
    db,
    workspace_identity_for(
      { ...input.identity, member_role: 'owner' },
      { organization_id: organization.id, organization_name: organization.name },
    ),
  );
  report_workspace_created(input.identity, actor);
  await provision_workspace_volume(db, actor.workspace_id, actor.user_id);
  await remember_active_organization(db, workos_user_id, organization.id);
  return {
    organization_id: organization.id,
    workspace: await find_workspace_profile(db, actor.workspace_id),
  };
}

export async function set_active_organization(
  db: Database,
  input: { provider_user_id: string; organization_id: string },
): Promise<void> {
  await remember_active_organization(db, input.provider_user_id, input.organization_id);
}

export async function sync_organization_membership(
  db: Database,
  input: {
    action: 'upsert' | 'deactivate';
    provider_user_id: string;
    organization_id: string;
    role_slug?: string;
  },
  deps: WorkspaceServiceDeps = default_deps,
): Promise<void> {
  if (input.action === 'deactivate') {
    await deactivate_workspace_member(db, {
      provider_key: workos_provider_key,
      organization_id: input.organization_id,
      provider_user_id: input.provider_user_id,
    });
    return;
  }

  const profile = await deps.get_workos_user(input.provider_user_id);
  const identity: WorkspaceIdentity = {
    provider_key: workos_provider_key,
    provider_user_id: input.provider_user_id,
    organization_id: input.organization_id,
    member_role: input.role_slug === 'admin' ? 'owner' : 'member',
    member_status: 'active',
    ...(profile?.email ? { email: profile.email } : {}),
    ...(profile?.first_name ? { first_name: profile.first_name } : {}),
    ...(profile?.last_name ? { last_name: profile.last_name } : {}),
    ...(profile?.avatar_url ? { avatar_url: profile.avatar_url } : {}),
  };
  const actor = await provision_workspace_for_identity(db, identity);
  report_workspace_created(identity, actor);
}

async function enter_workspace(
  db: Database,
  identity: WorkspaceIdentity,
  organization: ResolvedOrganization,
  deps: WorkspaceServiceDeps,
): Promise<AuthenticatedWorkspace> {
  const [actor] = await Promise.all([
    provision_workspace_and_volume(db, workspace_identity_for(identity, organization)),
    promote_admin_best_effort(organization.organization_id, identity.provider_user_id, deps),
  ]);

  await remember_active_organization(db, identity.provider_user_id, organization.organization_id);
  return {
    user_id: actor.user_id,
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    ...organization,
  };
}

async function provision_workspace_and_volume(db: Database, identity: WorkspaceIdentity) {
  const actor = await provision_workspace_for_identity(db, identity);
  report_workspace_created(identity, actor);
  await provision_workspace_volume(db, actor.workspace_id, actor.user_id);
  return actor;
}

function report_workspace_created(identity: WorkspaceIdentity, actor: ProvisionedWorkspace): void {
  if (!actor.workspace_was_created && !actor.user_was_created) return;
  const full_name = [identity.first_name, identity.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  const person = {
    distinct_id: identity.provider_user_id,
    email: identity.email ?? null,
    name: full_name || null,
  };
  if (actor.user_was_created) {
    void capture_product_event({
      person,
      event: 'user_signed_up',
      properties: {
        workspace_id: actor.workspace_id,
        joined_existing_workspace: !actor.workspace_was_created,
      },
    });
  }
  if (actor.workspace_was_created) {
    void capture_product_event({
      person,
      event: 'workspace_created',
      properties: { workspace_id: actor.workspace_id, is_first_workspace: actor.user_was_created },
    });
  }
}

async function resolve_personal_organization(
  identity: WorkspaceIdentity,
  deps: WorkspaceServiceDeps,
): Promise<ResolvedOrganization> {
  const workos_user_id = identity.provider_user_id;
  const external_id = `${personal_organization_external_id_prefix}${workos_user_id}`;
  const organization =
    (await deps.find_workos_organization_by_external_id(external_id)) ??
    (await deps.create_workos_organization({
      name: organization_name_from_identity(identity),
      external_id,
      workos_user_id,
    }));
  if (!organization) throw new Error('Could not resolve or create a WorkOS organization');
  await deps.create_admin_member_if_absent({ organization_id: organization.id, workos_user_id });
  return { organization_id: organization.id, organization_name: organization.name };
}

function workspace_identity_for(
  identity: WorkspaceIdentity,
  organization: ResolvedOrganization,
): WorkspaceIdentity {
  return {
    ...identity,
    organization_id: organization.organization_id,
    ...(organization.organization_name
      ? { organization_name: organization.organization_name }
      : {}),
  };
}

async function promote_admin_best_effort(
  organization_id: string,
  workos_user_id: string,
  deps: WorkspaceServiceDeps,
) {
  try {
    await deps.promote_sole_member_to_admin({ organization_id, workos_user_id });
  } catch (error) {
    log.error('WorkOS admin promotion failed', { organization_id, error });
  }
}

async function remember_active_organization(
  db: Database,
  provider_user_id: string,
  organization_id: string,
) {
  await set_last_active_organization(db, {
    provider_key: workos_provider_key,
    provider_user_id,
    organization_id,
  });
}

function organization_name_from_identity(identity: WorkspaceIdentity): string {
  const full_name = [identity.first_name, identity.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  if (full_name) return full_name;
  return identity.email?.split('@')[0]?.trim() || 'Workspace';
}
