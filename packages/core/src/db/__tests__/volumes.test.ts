import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_volume, find_volume } from '@coworker/core/db/queries/volumes';
import { describe, expect, it } from 'vitest';

describe('volumes', () => {
  it('owns one durable volume independently from replaceable compute', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const created = await create_volume(db, {
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'active',
      provider_volume_id: `dsk_${bootstrap.workspace_id}`,
      actor_id: bootstrap.user_id,
    });

    expect(created).toMatchObject({
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      volume_status: 'active',
    });
    expect(created.volume_config).toMatchObject({
      storage_path: `coworker/volumes/${created.volume_id}/`,
      storage_layout: 'volume_keyed',
      workspace_layout_version: 2,
    });
    expect(created.volume_id).toMatch(/^vol_/u);
    await expect(find_volume(db, bootstrap.workspace_id)).resolves.toMatchObject({
      volume_id: created.volume_id,
    });
  });

  it('does not let two workspaces point at the same provider disk', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await create_volume(db, {
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'active',
      provider_volume_id: 'dsk_shared',
      actor_id: bootstrap.user_id,
    });

    await expect(
      create_volume(db, {
        workspace_id: 'wrk_other',
        volume_provider: 'archil',
        workspace_layout_version: 2,
        volume_status: 'active',
        provider_volume_id: 'dsk_shared',
        actor_id: bootstrap.user_id,
      }),
    ).rejects.toThrow();
  });
});
