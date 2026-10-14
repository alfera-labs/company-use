import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_runtime_environment } from '@coworker/core/db/queries/sessions';
import { create_volume } from '@coworker/core/db/queries/volumes';
import { read_volume_file_bytes } from '@runtime-platform/files/volume_file_reader';
import { describe, expect, it, vi } from 'vitest';

async function stopped_volume_fixture(
  environment_layout:
    | { workspace_layout_version: number; agent_workspace_path: string }
    | undefined = undefined,
) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const volume = await create_volume(db, {
    workspace_id: bootstrap.workspace_id,
    volume_provider: 'archil',
    workspace_layout_version: 2,
    volume_status: 'active',
    provider_volume_id: 'dsk_artifact_test',
    provider_region: 'aws-us-east-1',
    actor_id: bootstrap.user_id,
  });
  const runtime_environment = await create_runtime_environment(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: null,
    agent_id: null,
    environment_provider: 'e2b',
    environment_status: 'stopped',
    workspace_mount_key: `workspace:${bootstrap.workspace_id}`,
    root_path: '/work',
    environment_metadata: { volume_id: volume.volume_id, ...(environment_layout ?? {}) },
    actor_id: bootstrap.user_id,
  });
  return { db, bootstrap, runtime_environment };
}

describe('volume artifact reads', () => {
  it('reads the file where the environment recorded its workspace on the volume', async () => {
    const fixture = await stopped_volume_fixture({
      workspace_layout_version: 2,
      agent_workspace_path: 'agents/agt_1/workspace',
    });
    const read_archil_bytes = vi.fn().mockResolvedValue(new TextEncoder().encode('report'));

    await read_volume_file_bytes(
      fixture.db,
      {
        workspace_id: fixture.bootstrap.workspace_id,
        runtime_environment: fixture.runtime_environment,
        workspace_path: 'artifacts/report.md',
      },
      read_archil_bytes,
    );

    expect(read_archil_bytes).toHaveBeenCalledWith(
      expect.objectContaining({
        volume_relative_path: 'agents/agt_1/workspace/artifacts/report.md',
      }),
    );
  });

  it('reads the older layout key when the environment recorded no workspace path', async () => {
    const fixture = await stopped_volume_fixture();
    const read_archil_bytes = vi.fn().mockResolvedValue(new TextEncoder().encode('report'));

    await read_volume_file_bytes(
      fixture.db,
      {
        workspace_id: fixture.bootstrap.workspace_id,
        runtime_environment: fixture.runtime_environment,
        workspace_path: 'artifacts/report.md',
      },
      read_archil_bytes,
    );

    expect(read_archil_bytes).toHaveBeenCalledWith(
      expect.objectContaining({ volume_relative_path: 'workspace/artifacts/report.md' }),
    );
  });

  it('preserves a provider 404 so the artifact service can mark the file missing', async () => {
    const fixture = await stopped_volume_fixture();
    const missing = Object.assign(new Error('NoSuchKey'), { status: 404 });

    await expect(
      read_volume_file_bytes(
        fixture.db,
        {
          workspace_id: fixture.bootstrap.workspace_id,
          runtime_environment: fixture.runtime_environment,
          workspace_path: 'artifacts/missing.txt',
        },
        vi.fn().mockRejectedValue(missing),
      ),
    ).rejects.toBe(missing);
  });

  it('returns a stable 503 for a provider outage', async () => {
    const fixture = await stopped_volume_fixture();

    await expect(
      read_volume_file_bytes(
        fixture.db,
        {
          workspace_id: fixture.bootstrap.workspace_id,
          runtime_environment: fixture.runtime_environment,
          workspace_path: 'artifacts/report.txt',
        },
        vi.fn().mockRejectedValue(Object.assign(new Error('provider down'), { status: 500 })),
      ),
    ).rejects.toMatchObject({
      code: 'artifact_storage_temporarily_unavailable',
      status: 503,
    });
  });
});
