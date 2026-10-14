import type { Database } from '@coworker/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  provision_workspace_for_identity: vi.fn(),
  set_last_active_organization: vi.fn(),
}));
const provision_workspace_volume = vi.hoisted(() => vi.fn());

vi.mock('@coworker/core/db/queries/workspace_provisioning', async (import_original) => ({
  ...(await import_original<typeof import('@coworker/core/db/queries/workspace_provisioning')>()),
  provision_workspace_for_identity: core.provision_workspace_for_identity,
}));

vi.mock('@coworker/core/db/queries/workspace_membership', async (import_original) => ({
  ...(await import_original<typeof import('@coworker/core/db/queries/workspace_membership')>()),
  set_last_active_organization: core.set_last_active_organization,
}));

vi.mock('@api/services/provisioning/workspace_volume_provisioning', () => ({
  provision_workspace_volume,
}));

const { provision_workspace_for_authenticated_user } = await import('@api/services/workspace');

const db = {} as Database;
const identity = {
  provider_key: 'workos',
  provider_user_id: 'user_workos_1',
  organization_id: 'org_1',
  email: 'signer@example.com',
};
const actor = { user_id: 'user_1', workspace_id: 'ws_1', agent_id: 'agent_1' };

function service_deps(overrides: Record<string, unknown> = {}) {
  return {
    update_workos_organization_name: vi.fn(),
    create_workos_organization: vi.fn(),
    find_workos_organization_by_external_id: vi.fn(),
    list_active_memberships_for_user: vi.fn(),
    create_admin_member_if_absent: vi.fn(),
    promote_sole_member_to_admin: vi.fn().mockResolvedValue(undefined),
    get_workos_user: vi.fn(),
    list_pending_workspace_invitations: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof provision_workspace_for_authenticated_user>[2];
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('entering a workspace on sign-in', () => {
  it('provisions the workspace, its volume, and remembers the organization', async () => {
    core.provision_workspace_for_identity.mockResolvedValue(actor);
    provision_workspace_volume.mockResolvedValue(null);
    const deps = service_deps();

    const workspace = await provision_workspace_for_authenticated_user(db, identity, deps);

    expect(workspace).toMatchObject({ ...actor, organization_id: 'org_1' });
    expect(provision_workspace_volume).toHaveBeenCalledWith(db, 'ws_1', 'user_1');
    expect(core.set_last_active_organization).toHaveBeenCalledWith(db, {
      provider_key: 'workos',
      provider_user_id: 'user_workos_1',
      organization_id: 'org_1',
    });
  });

  it('checks the WorkOS role without waiting for the local rows', async () => {
    const order: string[] = [];
    core.provision_workspace_for_identity.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('provisioned');
      return actor;
    });
    provision_workspace_volume.mockResolvedValue(null);
    const deps = service_deps({
      promote_sole_member_to_admin: vi.fn(async () => {
        order.push('promoted');
      }),
    });

    await provision_workspace_for_authenticated_user(db, identity, deps);

    expect(order).toEqual(['promoted', 'provisioned']);
  });

  it('signs the user in even when the WorkOS role check fails', async () => {
    core.provision_workspace_for_identity.mockResolvedValue(actor);
    provision_workspace_volume.mockResolvedValue(null);
    const deps = service_deps({
      promote_sole_member_to_admin: vi.fn().mockRejectedValue(new Error('WorkOS is down')),
    });

    const workspace = await provision_workspace_for_authenticated_user(db, identity, deps);

    expect(workspace).toMatchObject({ workspace_id: 'ws_1' });
    expect(core.set_last_active_organization).toHaveBeenCalled();
  });

  it('does not remember an organization whose workspace failed to provision', async () => {
    core.provision_workspace_for_identity.mockRejectedValue(new Error('database is down'));
    const deps = service_deps();

    await expect(provision_workspace_for_authenticated_user(db, identity, deps)).rejects.toThrow(
      'database is down',
    );
    expect(core.set_last_active_organization).not.toHaveBeenCalled();
  });

  it('does not remember an organization whose volume failed to provision', async () => {
    core.provision_workspace_for_identity.mockResolvedValue(actor);
    provision_workspace_volume.mockRejectedValue(new Error('volume provisioning failed'));
    const deps = service_deps();

    await expect(provision_workspace_for_authenticated_user(db, identity, deps)).rejects.toThrow(
      'volume provisioning failed',
    );
    expect(core.set_last_active_organization).not.toHaveBeenCalled();
  });

  it('surfaces the provisioning failure when the WorkOS role check also fails', async () => {
    provision_workspace_volume.mockRejectedValue(new Error('volume provisioning failed'));
    core.provision_workspace_for_identity.mockResolvedValue(actor);
    const deps = service_deps({
      promote_sole_member_to_admin: vi.fn().mockRejectedValue(new Error('WorkOS is down')),
    });

    await expect(provision_workspace_for_authenticated_user(db, identity, deps)).rejects.toThrow(
      'volume provisioning failed',
    );
  });
});
