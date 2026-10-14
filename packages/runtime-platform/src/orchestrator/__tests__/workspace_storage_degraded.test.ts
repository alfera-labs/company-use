import os from 'node:os';
import path from 'node:path';
import { AppError } from '@coworker/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@runtime-platform/storage/volume_runtime', async (import_original) => {
  const actual = await import_original<typeof import('@runtime-platform/storage/volume_runtime')>();
  return {
    ...actual,
    open_volume: vi.fn(async () => {
      throw new AppError(
        'durable_storage_unavailable',
        'Durable workspace storage is unavailable right now. Please retry shortly.',
        503,
      );
    }),
  };
});

describe('open_or_create_coding_workspace when durable storage is unavailable', () => {
  it('continues on ephemeral compute and flags the degraded run', async () => {
    const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
    const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
    const { create_session } = await import('@coworker/core/db/queries/sessions');
    const { open_or_create_coding_workspace } = await import(
      '@runtime-platform/orchestrator/workspace_runtime'
    );

    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Storage degraded test',
      actor_id: bootstrap.user_id,
    });

    const workspace = await open_or_create_coding_workspace(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      run_id: 'run_storage_degraded',
      actor_id: bootstrap.user_id,
      provider: 'local' as const,
      workspace_base_path: path.join(
        os.tmpdir(),
        `coworker-storage-degraded-${session.session_id}`,
      ),
    });

    expect(workspace.durable_storage_unavailable).toBe(true);
    expect(workspace.volume).toBeUndefined();
    expect(workspace.environment).toBeDefined();
  });
});
