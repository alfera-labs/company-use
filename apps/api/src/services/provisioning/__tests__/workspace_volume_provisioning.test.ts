import { env } from '@coworker/config';
import { workspaces } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_volume } from '@coworker/core/db/queries/volumes';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { provision_volume } from '@coworker/runtime-platform';
import { AppError } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@coworker/runtime-platform', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/runtime-platform')>();
  return { ...actual, provision_volume: vi.fn(async () => ({}) as never) };
});

const { read_workspace_volume_rollout, run_workspace_volume_backfill } = await import(
  '@api/services/provisioning/workspace_volume_backfill'
);
const { provision_workspace_volume } = await import(
  '@api/services/provisioning/workspace_volume_provisioning'
);
const {
  create_user_workspace,
  provision_workspace_for_authenticated_user,
  sync_organization_membership,
} = await import('@api/services/workspace');

describe('workspace volume provisioning', () => {
  const persistent_workspaces_enabled = env.COWORKER_PERSISTENT_WORKSPACES_ENABLED;

  beforeEach(() => {
    vi.mocked(provision_volume).mockReset();
    vi.mocked(provision_volume).mockResolvedValue({} as never);
  });

  afterEach(() => {
    Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: persistent_workspaces_enabled });
  });

  it('does nothing while persistent workspaces are disabled', async () => {
    Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: false });
    const db = await create_test_database();

    await expect(
      provision_workspace_volume(db, 'ws_disabled', 'user_disabled'),
    ).resolves.toBeNull();
    expect(provision_volume).not.toHaveBeenCalled();
  });

  it('waits for volume provisioning during authenticated workspace creation', async () => {
    Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: true });
    const db = await create_test_database();
    const actor = await provision_workspace_for_authenticated_user(
      db,
      identity_input('auth'),
      workos_adapters(),
    );

    expect(provision_volume).toHaveBeenCalledWith(db, {
      workspace_id: actor.workspace_id,
      actor_id: actor.user_id,
    });
  });

  it('surfaces volume provisioning failures during authenticated workspace creation', async () => {
    Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: true });
    vi.mocked(provision_volume).mockRejectedValue(new Error('Archil unavailable'));
    const db = await create_test_database();

    await expect(
      provision_workspace_for_authenticated_user(db, identity_input('failure'), workos_adapters()),
    ).rejects.toThrow('Archil unavailable');
  });

  it('keeps sign-in available when the existing volume is not active', async () => {
    Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: true });
    vi.mocked(provision_volume).mockRejectedValue(
      new AppError('volume_not_active', 'Volume is unhealthy.', 409),
    );
    const db = await create_test_database();

    const actor = await provision_workspace_for_authenticated_user(
      db,
      identity_input('unhealthy'),
      workos_adapters(),
    );

    expect(actor.workspace_id).toBeTruthy();
  });

  it('surfaces volume provisioning failures during named workspace creation', async () => {
    Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: true });
    vi.mocked(provision_volume).mockRejectedValue(new Error('Archil unavailable'));
    const db = await create_test_database();

    await expect(
      create_user_workspace(
        db,
        { identity: identity_input('named'), name: 'Named workspace' },
        workos_adapters(),
      ),
    ).rejects.toThrow('Archil unavailable');
  });

  it('does not provision infrastructure from membership webhooks', async () => {
    Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: true });
    const db = await create_test_database();

    await sync_organization_membership(
      db,
      {
        action: 'upsert',
        provider_user_id: 'user_member',
        organization_id: 'org_member',
      },
      workos_adapters(),
    );

    expect(provision_volume).not.toHaveBeenCalled();
  });

  it('backfills every active workspace without an active volume', async () => {
    const db = await create_test_database();
    const missing = await provision_workspace_for_identity(db, identity_input('missing'));
    const complete = await provision_workspace_for_identity(db, identity_input('complete'));
    const inactive = await provision_workspace_for_identity(db, identity_input('inactive'));
    await create_volume(db, {
      workspace_id: complete.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'active',
      provider_volume_id: 'dsk_complete',
      actor_id: complete.user_id,
    });
    await db
      .update(workspaces)
      .set({ workspace_status: 'inactive' })
      .where(eq(workspaces.workspace_id, inactive.workspace_id));

    expect(await read_workspace_volume_rollout(db)).toEqual({
      active_workspaces: 2,
      active_volumes: 1,
      workspaces_needing_volume: 1,
    });
    await expect(
      run_workspace_volume_backfill(db, { limit: 100, concurrency: 1 }),
    ).resolves.toMatchObject({
      workspaces_checked: 1,
      volumes_provisioned: 1,
      volumes_failed: 0,
    });
    expect(provision_volume).toHaveBeenCalledWith(db, {
      workspace_id: missing.workspace_id,
      actor_id: 'system:workspace_volume_backfill',
    });
  });

  it('reports individual backfill failures without skipping other workspaces', async () => {
    const db = await create_test_database();
    const first = await provision_workspace_for_identity(db, identity_input('first'));
    const second = await provision_workspace_for_identity(db, identity_input('second'));
    vi.mocked(provision_volume).mockImplementation(async (_db, input) => {
      if (input.workspace_id === first.workspace_id) throw new Error('provider unavailable');
      return {} as never;
    });

    const result = await run_workspace_volume_backfill(db, { limit: 100, concurrency: 1 });

    expect(result).toMatchObject({
      workspaces_checked: 2,
      volumes_provisioned: 1,
      volumes_failed: 1,
      failures: [{ workspace_id: first.workspace_id, error: 'provider unavailable' }],
    });
    expect(provision_volume).toHaveBeenCalledWith(db, {
      workspace_id: second.workspace_id,
      actor_id: 'system:workspace_volume_backfill',
    });
  });
});

function identity_input(suffix: string) {
  return {
    provider_key: 'workos',
    provider_user_id: `user_${suffix}`,
    organization_id: `org_${suffix}`,
    email: `${suffix}@example.com`,
    first_name: 'Volume',
    last_name: 'Tester',
  };
}

function workos_adapters() {
  return {
    update_workos_organization_name: vi.fn(async () => {}),
    create_workos_organization: vi.fn(async ({ name }: { name: string }) => ({
      id: 'unused',
      name,
    })),
    find_workos_organization_by_external_id: vi.fn(async () => null),
    list_active_memberships_for_user: vi.fn(async () => []),
    create_admin_member_if_absent: vi.fn(async () => {}),
    promote_sole_member_to_admin: vi.fn(async () => {}),
    get_workos_user: vi.fn(async () => null),
    list_pending_workspace_invitations: vi.fn(async () => []),
  };
}
