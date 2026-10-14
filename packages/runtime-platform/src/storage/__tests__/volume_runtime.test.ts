import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_volume } from '@coworker/core/db/queries/volumes';
import { provision_volume } from '@runtime-platform/storage/volume_provisioner';
import { open_volume } from '@runtime-platform/storage/volume_runtime';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@runtime-platform/storage/volume_provisioner', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/storage/volume_provisioner')>();
  return { ...actual, provision_volume: vi.fn() };
});

async function create_active_volume(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  provider_volume_id: string,
) {
  return create_volume(db, {
    workspace_id: bootstrap.workspace_id,
    volume_provider: 'archil',
    workspace_layout_version: 2,
    volume_status: 'active',
    provider_volume_id,
    provider_region: 'aws-us-east-1',
    encrypted_mount_credentials: { mount_token: 'test-mount-token' },
    actor_id: bootstrap.user_id,
  });
}

describe('open_volume (shared mount, per-session sandbox)', () => {
  it('mounts the shared disk with a per-session mount key and no whole-disk lease', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const volume = await create_active_volume(db, bootstrap, 'dsk_shared_open');

    const opened = await open_volume(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: 'ses_a',
      run_id: 'run_a',
      compute_provider: 'e2b',
      enabled: true,
      actor_id: bootstrap.user_id,
    });

    expect(opened).toMatchObject({
      volume_id: volume.volume_id,
      provider: 'archil',
      provider_volume_id: 'dsk_shared_open',
      mount_token: 'test-mount-token',
      workspace_mount_key: `workspace:${bootstrap.workspace_id}:ses_a`,
    });
    expect(opened).not.toHaveProperty('lease');
    expect(opened).not.toHaveProperty('force_reclaim');
  });

  it('lets two concurrent sessions mount the same disk without contention', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const volume = await create_active_volume(db, bootstrap, 'dsk_concurrent');

    const [first, second] = await Promise.all([
      open_volume(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: 'ses_one',
        run_id: 'run_one',
        compute_provider: 'e2b',
        enabled: true,
        actor_id: bootstrap.user_id,
      }),
      open_volume(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: 'ses_two',
        run_id: 'run_two',
        compute_provider: 'e2b',
        enabled: true,
        actor_id: bootstrap.user_id,
      }),
    ]);

    expect(first?.provider_volume_id).toBe('dsk_concurrent');
    expect(second?.provider_volume_id).toBe('dsk_concurrent');
    expect(first?.workspace_mount_key).toBe(`workspace:${bootstrap.workspace_id}:ses_one`);
    expect(second?.workspace_mount_key).toBe(`workspace:${bootstrap.workspace_id}:ses_two`);
    expect(first?.volume_id).toBe(volume.volume_id);
    expect(second?.volume_id).toBe(volume.volume_id);
  });

  it('refuses to mount a volume that is not active', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await create_volume(db, {
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'provisioning',
      provider_volume_id: 'dsk_provisioning',
      provider_region: 'aws-us-east-1',
      encrypted_mount_credentials: { mount_token: 'test-mount-token' },
      actor_id: bootstrap.user_id,
    });

    await expect(
      open_volume(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: 'ses_x',
        run_id: 'run_x',
        compute_provider: 'e2b',
        enabled: true,
        actor_id: bootstrap.user_id,
      }),
    ).rejects.toMatchObject({ code: 'volume_not_active' });
  });

  it('rejects a missing Archil mount token', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await create_volume(db, {
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'active',
      provider_volume_id: 'dsk_broken_credentials',
      provider_region: 'aws-us-east-1',
      encrypted_mount_credentials: { malformed: true },
      actor_id: bootstrap.user_id,
    });

    await expect(
      open_volume(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: 'ses_broken',
        run_id: 'run_broken',
        compute_provider: 'e2b',
        enabled: true,
        actor_id: bootstrap.user_id,
      }),
    ).rejects.toThrow(/no usable Archil mount token/iu);
  });

  it('provisions the volume on the spot when a persistent workspace has none', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    vi.mocked(provision_volume).mockImplementation(
      async (mock_db, mock_input) =>
        create_volume(mock_db, {
          workspace_id: mock_input.workspace_id,
          volume_provider: 'archil',
          workspace_layout_version: 2,
          volume_status: 'active',
          provider_volume_id: 'dsk_on_the_spot',
          provider_region: 'aws-us-east-1',
          encrypted_mount_credentials: { mount_token: 'test-mount-token' },
          actor_id: mock_input.actor_id,
        }) as never,
    );

    await expect(
      open_volume(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: 'ses_provision_on_open',
        run_id: 'run_provision_on_open',
        compute_provider: 'e2b',
        enabled: true,
        actor_id: bootstrap.user_id,
      }),
    ).resolves.toMatchObject({ provider_volume_id: 'dsk_on_the_spot' });
    expect(provision_volume).toHaveBeenCalledWith(db, {
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
    });
  });

  it('fails with one named code when on-the-spot provisioning fails', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(provision_volume).mockRejectedValue(new Error('Archil is down'));

    await expect(
      open_volume(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: 'ses_storage_down',
        run_id: 'run_storage_down',
        compute_provider: 'e2b',
        enabled: true,
        actor_id: bootstrap.user_id,
      }),
    ).rejects.toMatchObject({ code: 'durable_storage_unavailable', status: 503 });

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toContain('provisioning failed');
    expect(error.mock.calls[0]?.[0]).toContain(bootstrap.workspace_id);
    error.mockRestore();
  });

  it('stays silent when persistence is disabled and no volume exists', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const opened = await open_volume(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: 'ses_disabled',
      run_id: 'run_disabled',
      compute_provider: 'e2b',
      enabled: false,
      actor_id: bootstrap.user_id,
    });

    expect(opened).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
