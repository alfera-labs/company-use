import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { complete_onboarding } from '@coworker/core/db/queries/onboarding';
import {
  find_workspace_profile,
  provision_workspace_for_identity,
  rename_workspace,
} from '@coworker/core/db/queries/workspace_provisioning';
import { users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('workspace provisioning', () => {
  it('creates a local user, workspace, membership, and agent for a provider user', async () => {
    const db = await create_test_database();

    const actor = await provision_workspace_for_identity(db, {
      provider_key: 'auth0',
      provider_user_id: 'user_123',
      organization_id: 'org_123',
      email: 'Founder@Example.com',
      first_name: 'Olivier',
      last_name: 'Park',
      user_data: { locale: 'en-US' },
      workspace_data: { source: 'auth0' },
    });

    const user = await db.query.users.findFirst({
      where: (table, { eq }) => eq(table.user_id, actor.user_id),
    });
    const workspace = await db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.workspace_id, actor.workspace_id),
    });
    const member = await db.query.workspace_members.findFirst({
      where: (table, { eq }) => eq(table.workspace_id, actor.workspace_id),
    });
    const agent = await db.query.agents.findFirst({
      where: (table, { eq }) => eq(table.agent_id, actor.agent_id),
    });

    expect(user).toMatchObject({
      email: 'founder@example.com',
      first_name: 'Olivier',
      last_name: 'Park',
      external_identity_provider: 'auth0',
      external_identity_id: 'user_123',
      user_data: { locale: 'en-US' },
    });
    expect(workspace).toMatchObject({
      workspace_name: "Olivier's Workspace",
      external_identity_provider: 'auth0',
      external_identity_id: 'organization:org_123',
      workspace_status: 'active',
      workspace_data: { source: 'auth0' },
    });
    expect(member).toMatchObject({
      workspace_id: actor.workspace_id,
      user_id: actor.user_id,
      member_role: 'owner',
      external_identity_provider: 'auth0',
      external_identity_id: 'organization_membership:org_123:user_123',
    });
    expect(agent).toMatchObject({
      workspace_id: actor.workspace_id,
      agent_slug: 'main',
      agent_status: 'active',
    });
  });

  it('refuses to provision a workspace without an organization', async () => {
    const db = await create_test_database();

    await expect(
      provision_workspace_for_identity(db, {
        provider_key: 'auth0',
        provider_user_id: 'user_123',
        email: 'founder@example.com',
      }),
    ).rejects.toThrow('organization_id is required');
  });

  it('is idempotent for the same provider organization identity', async () => {
    const db = await create_test_database();

    const first_actor = await provision_workspace_for_identity(db, {
      provider_key: 'auth0',
      provider_user_id: 'user_123',
      organization_id: 'org_123',
      email: 'founder@example.com',
      first_name: 'Founder',
      last_name: 'One',
    });
    const second_actor = await provision_workspace_for_identity(db, {
      provider_key: 'auth0',
      provider_user_id: 'user_123',
      organization_id: 'org_123',
      email: 'founder@example.com',
      first_name: 'Founder',
      last_name: 'Updated',
    });
    const all_workspaces = await db.select().from(workspaces);
    const all_members = await db.select().from(workspace_members);
    const [updated_user] = await db
      .select()
      .from(users)
      .where(eq(users.external_identity_id, 'user_123'));

    expect(first_actor).toMatchObject({ workspace_was_created: true, user_was_created: true });
    expect(second_actor).toEqual({
      ...first_actor,
      workspace_was_created: false,
      user_was_created: false,
    });
    expect(all_workspaces).toHaveLength(1);
    expect(all_members).toHaveLength(1);
    expect(updated_user).toMatchObject({ first_name: 'Founder', last_name: 'Updated' });
  });

  it('keeps a user-chosen workspace name when provisioning runs again on the next login', async () => {
    const db = await create_test_database();

    const actor = await provision_workspace_for_identity(db, {
      provider_key: 'auth0',
      provider_user_id: 'user_123',
      organization_id: 'org_123',
      email: 'founder@example.com',
      first_name: 'Olivier',
    });
    await rename_workspace(db, {
      workspace_id: actor.workspace_id,
      workspace_name: 'Acme Inc',
      actor_id: actor.user_id,
    });

    await provision_workspace_for_identity(db, {
      provider_key: 'auth0',
      provider_user_id: 'user_123',
      organization_id: 'org_123',
      email: 'founder@example.com',
      first_name: 'Olivier',
    });

    const workspace = await find_workspace_profile(db, actor.workspace_id);
    expect(workspace?.workspace_name).toBe('Acme Inc');
  });

  it('defaults only the first workspace member to owner', async () => {
    const db = await create_test_database();

    const first_actor = await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_first',
      organization_id: 'org_team',
      email: 'first@example.com',
    });
    const second_actor = await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_second',
      organization_id: 'org_team',
      email: 'second@example.com',
    });
    const members = await db.query.workspace_members.findMany({
      where: (table, { eq }) => eq(table.workspace_id, first_actor.workspace_id),
    });

    expect(second_actor.workspace_id).toBe(first_actor.workspace_id);
    expect(
      members
        .map((member) => ({ user_id: member.user_id, member_role: member.member_role }))
        .sort((left, right) => left.user_id.localeCompare(right.user_id)),
    ).toEqual([
      { user_id: first_actor.user_id, member_role: 'owner' },
      { user_id: second_actor.user_id, member_role: 'member' },
    ]);
  });

  it('preserves an existing member role when provisioning runs again without an explicit role', async () => {
    const db = await create_test_database();

    const actor = await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_admin',
      organization_id: 'org_role',
      email: 'admin@example.com',
      member_role: 'admin',
    });
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_admin',
      organization_id: 'org_role',
      email: 'admin@example.com',
    });
    const member = await db.query.workspace_members.findFirst({
      where: (table, { eq }) => eq(table.user_id, actor.user_id),
    });

    expect(member).toMatchObject({ member_role: 'admin' });
  });

  it('claims an existing real-email user without racing the unique email index', async () => {
    const db = await create_test_database();
    const [existing_user] = await db
      .insert(users)
      .values({
        email: 'founder@example.com',
        user_status: 'active',
        created_by: 'test',
        last_updated_by: 'test',
      })
      .returning({ user_id: users.user_id });

    const actor = await provision_workspace_for_identity(db, {
      provider_key: 'auth0',
      provider_user_id: 'user_123',
      organization_id: 'org_123',
      email: 'founder@example.com',
      first_name: 'Updated',
    });
    const all_users = await db.select().from(users);

    expect(actor.user_id).toBe(existing_user?.user_id);
    expect(all_users).toHaveLength(1);
    expect(all_users[0]).toMatchObject({
      email: 'founder@example.com',
      first_name: 'Updated',
      external_identity_provider: 'auth0',
      external_identity_id: 'user_123',
    });
  });

  it('reports onboarding_completed off the workspace row so the gate needs no extra query', async () => {
    const db = await create_test_database();

    const actor = await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_gate',
      organization_id: 'org_gate',
      email: 'gate@example.com',
    });

    const before = await find_workspace_profile(db, actor.workspace_id);
    expect(before?.onboarding_completed).toBe(false);

    await complete_onboarding(db, { workspace_id: actor.workspace_id, actor_id: actor.user_id });

    const after = await find_workspace_profile(db, actor.workspace_id);
    expect(after?.onboarding_completed).toBe(true);
  });

  it('creates separate workspaces for separate provider organizations', async () => {
    const db = await create_test_database();

    const first_actor = await provision_workspace_for_identity(db, {
      provider_key: 'auth0',
      provider_user_id: 'user_123',
      organization_id: 'org_alpha',
      email: 'founder@example.com',
    });
    const second_actor = await provision_workspace_for_identity(db, {
      provider_key: 'auth0',
      provider_user_id: 'user_123',
      organization_id: 'org_beta',
      email: 'founder@example.com',
    });
    const identity_workspaces = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.external_identity_provider, 'auth0'));

    expect(first_actor.workspace_id).not.toBe(second_actor.workspace_id);
    expect(identity_workspaces.map((workspace) => workspace.external_identity_id).sort()).toEqual([
      'organization:org_alpha',
      'organization:org_beta',
    ]);
  });

  it('does not reactivate a suspended workspace when its owner signs in again', async () => {
    const db = await create_test_database();
    const actor = await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_farm',
      organization_id: 'org_farm',
      email: 'farm@example.com',
    });
    await db
      .update(workspaces)
      .set({ workspace_status: 'suspended', last_updated_by: 'admin:test' })
      .where(eq(workspaces.workspace_id, actor.workspace_id));

    const second_actor = await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_farm',
      organization_id: 'org_farm',
      email: 'farm@example.com',
    });

    const [workspace] = await db
      .select({ workspace_status: workspaces.workspace_status })
      .from(workspaces)
      .where(eq(workspaces.workspace_id, actor.workspace_id));
    expect(workspace?.workspace_status).toBe('suspended');
    expect(second_actor).toMatchObject({
      workspace_id: actor.workspace_id,
      workspace_was_created: false,
      user_was_created: false,
    });
  });

  it('reports no new user when the email already belongs to another identity', async () => {
    const db = await create_test_database();
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_first',
      organization_id: 'org_first',
      email: 'shared@example.com',
    });

    const second_actor = await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_second',
      organization_id: 'org_second',
      email: 'shared@example.com',
    });

    const all_users = await db.select().from(users);
    expect(all_users).toHaveLength(1);
    expect(second_actor.user_was_created).toBe(false);
  });
});
