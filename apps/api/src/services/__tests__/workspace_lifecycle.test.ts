import type { WorkspaceServiceDeps } from '@api/services/workspace';
import {
  create_user_workspace,
  list_workspace_invitations_to_offer,
  provision_personal_workspace,
  provision_workspace_for_authenticated_user,
  resolve_default_organization,
  sync_organization_membership,
} from '@api/services/workspace';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import {
  list_workspaces_for_user,
  set_last_active_organization,
} from '@coworker/core/db/queries/workspace_membership';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { users } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

function fake_deps(overrides: Partial<WorkspaceServiceDeps> = {}): WorkspaceServiceDeps {
  return {
    update_workos_organization_name: vi.fn(async () => {}),
    create_workos_organization: vi.fn(async ({ name }) => ({ id: 'org_created', name })),
    find_workos_organization_by_external_id: vi.fn(async () => null),
    list_active_memberships_for_user: vi.fn(async () => []),
    create_admin_member_if_absent: vi.fn(async () => {}),
    promote_sole_member_to_admin: vi.fn(async () => {}),
    get_workos_user: vi.fn(async () => ({ email: 'invitee@example.com' })),
    list_pending_workspace_invitations: vi.fn(async () => []),
    ...overrides,
  };
}

const northwind_invitation = {
  invitation_id: 'invitation_1',
  organization_id: 'org_northwind',
  organization_name: 'Northwind',
  accept_url: 'https://auth.example.com/invite?invitation_token=tok_1',
};

const identity = (extra: Record<string, unknown> = {}) => ({
  provider_key: 'workos',
  provider_user_id: 'user_1',
  email: 'a@example.com',
  ...extra,
});

async function user_id_for(
  db: Awaited<ReturnType<typeof create_test_database>>,
  provider_user_id: string,
) {
  const [row] = await db
    .select({ user_id: users.user_id })
    .from(users)
    .where(
      and(
        eq(users.external_identity_provider, 'workos'),
        eq(users.external_identity_id, provider_user_id),
      ),
    )
    .limit(1);
  return row?.user_id ?? null;
}

describe('workspace lifecycle service', () => {
  it('resolves the only active membership as the default organization', async () => {
    const db = await create_test_database();
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => [
        { organization_id: 'org_a', role_slug: 'admin' },
      ]),
    });
    expect((await resolve_default_organization(db, identity(), deps)).organization_id).toBe(
      'org_a',
    );
  });

  it('keeps a remembered membership even when the user is only a member there', async () => {
    const db = await create_test_database();
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_1',
      organization_id: 'org_member',
      member_role: 'member',
      member_status: 'active',
      email: 'a@example.com',
    });
    await set_last_active_organization(db, {
      provider_key: 'workos',
      provider_user_id: 'user_1',
      organization_id: 'org_member',
    });
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => [
        { organization_id: 'org_member', role_slug: 'member' },
        { organization_id: 'org_admin', role_slug: 'admin' },
      ]),
    });
    expect((await resolve_default_organization(db, identity(), deps)).organization_id).toBe(
      'org_member',
    );
  });

  it('prefers an admin membership over a newer member-role membership', async () => {
    const db = await create_test_database();
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => [
        { organization_id: 'org_member', role_slug: 'member' },
        { organization_id: 'org_admin', role_slug: 'admin' },
      ]),
    });
    expect((await resolve_default_organization(db, identity(), deps)).organization_id).toBe(
      'org_admin',
    );
  });

  it('falls back to a member-only membership when the user administers none', async () => {
    const db = await create_test_database();
    const create = vi.fn(async ({ name }: { name: string }) => ({ id: 'org_personal', name }));
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => [
        { organization_id: 'org_inviting', role_slug: 'member' },
      ]),
      create_workos_organization: create,
    });
    expect((await resolve_default_organization(db, identity(), deps)).organization_id).toBe(
      'org_inviting',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a personal org only when the user has no memberships', async () => {
    const db = await create_test_database();
    const create = vi.fn(async ({ name }: { name: string }) => ({ id: 'org_personal', name }));
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => []),
      create_workos_organization: create,
    });
    expect((await resolve_default_organization(db, identity(), deps)).organization_id).toBe(
      'org_personal',
    );
    expect(create).toHaveBeenCalled();
  });

  it('refuses to create a workspace for a user holding a pending team invitation', async () => {
    const db = await create_test_database();
    const create = vi.fn(async ({ name }: { name: string }) => ({ id: 'org_personal', name }));
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => []),
      list_pending_workspace_invitations: vi.fn(async () => [northwind_invitation]),
      create_workos_organization: create,
    });

    await expect(resolve_default_organization(db, identity(), deps)).rejects.toMatchObject({
      code: 'pending_invitation',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('offers the pending invitation to a user who has joined nothing yet', async () => {
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => []),
      list_pending_workspace_invitations: vi.fn(async () => [northwind_invitation]),
    });
    expect(await list_workspace_invitations_to_offer(identity(), deps)).toEqual([
      northwind_invitation,
    ]);
  });

  it('offers nothing to a user who already has a workspace', async () => {
    const list_invitations = vi.fn(async () => [northwind_invitation]);
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => [{ organization_id: 'org_a' }]),
      list_pending_workspace_invitations: list_invitations,
    });
    expect(await list_workspace_invitations_to_offer(identity(), deps)).toEqual([]);
    expect(list_invitations).not.toHaveBeenCalled();
  });

  it('creates the personal workspace when the user turns the invitations down', async () => {
    const db = await create_test_database();
    const deps = fake_deps({
      list_active_memberships_for_user: vi.fn(async () => []),
      list_pending_workspace_invitations: vi.fn(async () => [northwind_invitation]),
      create_workos_organization: vi.fn(async ({ name }) => ({ id: 'org_personal', name })),
    });

    const workspace = await provision_personal_workspace(db, identity(), deps);
    expect(workspace.organization_id).toBe('org_personal');
    const owner = await user_id_for(db, 'user_1');
    const workspaces = await list_workspaces_for_user(db, owner as string);
    expect(workspaces.map((w) => w.organization_id)).toEqual(['org_personal']);
  });

  it('provisions an authenticated user into the session organization', async () => {
    const db = await create_test_database();
    const actor = await provision_workspace_for_authenticated_user(
      db,
      identity({ organization_id: 'org_a' }),
      fake_deps(),
    );
    expect(actor.organization_id).toBe('org_a');
    expect(actor.workspace_id).toBeTruthy();
  });

  it('membership sync upsert adds an invitee to the inviting workspace', async () => {
    const db = await create_test_database();
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'owner_1',
      email: 'owner@example.com',
      organization_id: 'org_a',
    });
    await sync_organization_membership(
      db,
      {
        action: 'upsert',
        provider_user_id: 'invitee_1',
        organization_id: 'org_a',
        role_slug: 'member',
      },
      fake_deps(),
    );
    const invitee = await user_id_for(db, 'invitee_1');
    expect(invitee).not.toBeNull();
    const workspaces = await list_workspaces_for_user(db, invitee as string);
    expect(workspaces.map((w) => w.organization_id)).toEqual(['org_a']);
  });

  it('membership sync deactivate removes the membership', async () => {
    const db = await create_test_database();
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'owner_1',
      email: 'owner@example.com',
      organization_id: 'org_a',
    });
    await sync_organization_membership(
      db,
      { action: 'upsert', provider_user_id: 'invitee_1', organization_id: 'org_a' },
      fake_deps(),
    );
    await sync_organization_membership(db, {
      action: 'deactivate',
      provider_user_id: 'invitee_1',
      organization_id: 'org_a',
    });
    const invitee = await user_id_for(db, 'invitee_1');
    expect(await list_workspaces_for_user(db, invitee as string)).toHaveLength(0);
  });

  it('creates a named workspace as a new organization owned by the user', async () => {
    const db = await create_test_database();
    const created = await create_user_workspace(
      db,
      { identity: identity(), name: 'Acme' },
      fake_deps({
        create_workos_organization: vi.fn(async () => ({ id: 'org_acme', name: 'Acme' })),
      }),
    );
    expect(created.organization_id).toBe('org_acme');
    const owner = await user_id_for(db, 'user_1');
    const workspaces = await list_workspaces_for_user(db, owner as string);
    expect(workspaces.map((w) => w.organization_id)).toEqual(['org_acme']);
  });
});
