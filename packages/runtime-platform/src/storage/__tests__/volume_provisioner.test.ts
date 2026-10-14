import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_volume, find_volume } from '@coworker/core/db/queries/volumes';
import { volumes } from '@coworker/core/db/schema';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import { provision_volume } from '@runtime-platform/storage/volume_provisioner';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config_keys = [
  'ARCHIL_API_KEY',
  'ARCHIL_REGION',
  'R2_BUCKET_NAME',
  'R2_BUCKET_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;
const original_config = Object.fromEntries(config_keys.map((key) => [key, env[key]]));
const original_credential_key = process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;

beforeEach(() => {
  Object.assign(env, {
    ARCHIL_API_KEY: 'archil-test-key',
    ARCHIL_REGION: 'aws-us-east-1',
    R2_BUCKET_NAME: 'coworker-test',
    R2_BUCKET_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'r2-access-key',
    R2_SECRET_ACCESS_KEY: 'r2-secret-key',
  });
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'test-envelope-key';
});

afterEach(() => {
  Object.assign(env, original_config);
  if (original_credential_key === undefined) {
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  } else {
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = original_credential_key;
  }
});

describe('Archil volume provisioning', () => {
  it('creates one R2-backed disk and stores only an encrypted mount token', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const create_token = vi.fn().mockResolvedValue({ token: 'mount-token-secret' });
    const create_disk = vi.fn().mockResolvedValue({
      disk: {
        id: 'dsk_test',
        name: 'coworker-test',
        authorizedUsers: [],
        createToken: create_token,
        removeTokenUser: vi.fn(),
        delete: vi.fn(),
      },
    });

    const volume = await provision_volume(
      db,
      {
        workspace_id: bootstrap.workspace_id,
        actor_id: bootstrap.user_id,
      },
      () => ({
        disks: {
          create: create_disk,
          get: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
        },
      }),
    );

    expect(create_disk).toHaveBeenCalledWith({
      name: expect.stringMatching(/^coworker-vol-/u),
      mounts: [
        expect.objectContaining({
          type: 'r2',
          bucketName: 'coworker-test',
          bucketPrefix: volume.volume_config.storage_path,
        }),
      ],
      authMethods: [],
    });
    expect(volume.volume_id).toMatch(/^vol_/u);
    expect(create_token).toHaveBeenCalledWith('coworker-runtime');
    expect(volume).toMatchObject({
      volume_status: 'active',
      provider_volume_id: 'dsk_test',
    });
    expect(JSON.stringify(volume.encrypted_mount_credentials)).not.toContain('mount-token-secret');
    expect(
      read_connection_credential_value(volume.encrypted_mount_credentials, 'mount_token'),
    ).toBe('mount-token-secret');
  });

  it('keeps a cleaned provider failure retryable and succeeds on the next request', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const create_disk = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({
        disk: {
          id: 'dsk_retry_success',
          name: 'coworker-retry-success',
          authorizedUsers: [],
          createToken: vi.fn().mockResolvedValue({ token: 'retry-token' }),
          removeTokenUser: vi.fn(),
          delete: vi.fn(),
        },
      });
    const create_client = () => ({
      disks: {
        create: create_disk,
        get: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      },
    });

    await expect(
      provision_volume(
        db,
        {
          workspace_id: bootstrap.workspace_id,
          actor_id: bootstrap.user_id,
        },
        create_client,
      ),
    ).rejects.toMatchObject({
      code: 'archil_provisioning_failed',
      message: 'Persistent workspace provisioning failed. Please try again or contact support.',
      status: 502,
    });
    await expect(find_volume(db, bootstrap.workspace_id)).resolves.toMatchObject({
      volume_status: 'retryable',
      provider_volume_id: null,
      last_error_code: 'archil_provisioning_failed',
      last_error_message: 'provider unavailable',
    });

    await expect(
      provision_volume(
        db,
        { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id },
        create_client,
      ),
    ).resolves.toMatchObject({
      volume_status: 'active',
      provider_volume_id: 'dsk_retry_success',
    });
  });

  it('deletes and records a disk created before mount-token capture fails', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const delete_disk = vi.fn().mockResolvedValue(undefined);

    await expect(
      provision_volume(
        db,
        {
          workspace_id: bootstrap.workspace_id,
          actor_id: bootstrap.user_id,
        },
        () => ({
          disks: {
            create: vi.fn().mockResolvedValue({
              disk: {
                id: 'dsk_cleanup_test',
                name: 'coworker-cleanup-test',
                authorizedUsers: [],
                createToken: vi.fn().mockRejectedValue(new Error('token capture failed')),
                removeTokenUser: vi.fn(),
                delete: delete_disk,
              },
            }),
            get: vi.fn(),
            list: vi.fn().mockResolvedValue([]),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'archil_provisioning_failed', status: 502 });
    expect(delete_disk).toHaveBeenCalledOnce();
    await expect(find_volume(db, bootstrap.workspace_id)).resolves.toMatchObject({
      volume_status: 'retryable',
      provider_volume_id: null,
      last_error_message: 'token capture failed',
    });
  });

  it('marks the volume unhealthy when a failed provider disk cannot be deleted', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    await expect(
      provision_volume(
        db,
        { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id },
        () => ({
          disks: {
            create: vi.fn().mockResolvedValue({
              disk: {
                id: 'dsk_cleanup_failed',
                name: 'coworker-cleanup-failed',
                authorizedUsers: [],
                createToken: vi.fn().mockRejectedValue(new Error('token capture failed')),
                removeTokenUser: vi.fn(),
                delete: vi.fn().mockRejectedValue(new Error('disk delete failed')),
              },
            }),
            get: vi.fn(),
            list: vi.fn().mockResolvedValue([]),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'archil_provisioning_cleanup_failed', status: 502 });
    await expect(find_volume(db, bootstrap.workspace_id)).resolves.toMatchObject({
      volume_status: 'unhealthy',
      provider_volume_id: 'dsk_cleanup_failed',
      last_error_code: 'archil_provisioning_cleanup_failed',
    });
  });

  it('resumes a stale provisioning row by its stable Archil disk name', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const volume = await create_volume(db, {
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'provisioning',
      provider_region: 'aws-us-east-1',
      actor_id: bootstrap.user_id,
    });
    await db
      .update(volumes)
      .set({ last_updated_time: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(volumes.volume_id, volume.volume_id));
    const disk = {
      id: 'dsk_recovered',
      name: `coworker-${volume.volume_id.replaceAll('_', '-')}`,
      authorizedUsers: [{ type: 'token' as const, identifier: 'old-token' }],
      createToken: vi.fn().mockResolvedValue({ token: 'replacement-token' }),
      removeTokenUser: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    };
    const create_disk = vi.fn();

    const resumed = await provision_volume(
      db,
      { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id },
      () => ({
        disks: {
          create: create_disk,
          get: vi.fn(),
          list: vi.fn().mockResolvedValue([disk]),
        },
      }),
    );

    expect(create_disk).not.toHaveBeenCalled();
    expect(disk.removeTokenUser).toHaveBeenCalledWith('old-token');
    expect(resumed).toMatchObject({
      volume_status: 'active',
      provider_volume_id: 'dsk_recovered',
    });
  });

  it('does not start a second provider operation while provisioning is active', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await create_volume(db, {
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'provisioning',
      provider_region: 'aws-us-east-1',
      actor_id: bootstrap.user_id,
    });
    const create_disk = vi.fn();

    await expect(
      provision_volume(
        db,
        { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id },
        () => ({
          disks: { create: create_disk, get: vi.fn(), list: vi.fn() },
        }),
      ),
    ).rejects.toMatchObject({ code: 'volume_provisioning_in_progress', status: 409 });
    expect(create_disk).not.toHaveBeenCalled();
  });
});
