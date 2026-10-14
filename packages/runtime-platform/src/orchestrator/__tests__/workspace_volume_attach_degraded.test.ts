import { E2bVolumeError } from '@runtime-platform/orchestrator/e2b_volume';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@runtime-platform/storage/volume_runtime', async (import_original) => {
  const actual = await import_original<typeof import('@runtime-platform/storage/volume_runtime')>();
  return {
    ...actual,
    open_volume: vi.fn(async () => ({
      volume_id: 'vol_attach_degraded',
      workspace_mount_key: 'workspace:ws_attach:ses_attach',
      provider: 'archil',
      provider_volume_id: 'dsk_attach_degraded',
      provider_region: 'aws-us-west-2',
      root_path: '/mnt/coworker',
      mount_token: 'test-token',
    })),
  };
});

const create_e2b_session_env = vi.fn(async (input: { volume?: unknown }) => {
  if (input.volume) {
    throw new E2bVolumeError('Could not mount persistent volume: outstanding delegation');
  }
  return {
    metadata: {
      provider_environment_id: 'sbx_degraded',
      provider_sandbox_id: 'sbx_degraded',
      provider_template_id: 'tmpl_test',
    },
  } as never;
});

vi.mock('@runtime-platform/orchestrator/e2b_sandbox_client', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/orchestrator/e2b_sandbox_client')>();
  return { ...actual, create_e2b_session_env };
});

describe('open_or_create_coding_workspace when the volume cannot be attached', () => {
  it('retries once with the volume, then continues on ephemeral compute with the flag', async () => {
    const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
    const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
    const { create_session } = await import('@coworker/core/db/queries/sessions');
    const { open_or_create_coding_workspace, settled_coding_workspace } = await import(
      '@runtime-platform/orchestrator/workspace_runtime'
    );

    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Volume attach degrade test',
      actor_id: bootstrap.user_id,
    });

    const workspace = await open_or_create_coding_workspace(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      run_id: 'run_attach_degraded',
      actor_id: bootstrap.user_id,
      provider: 'e2b',
    });

    const settled = await settled_coding_workspace(workspace);
    expect(settled.durable_storage_unavailable).toBe(true);
    expect(settled.volume).toBeUndefined();
    expect(create_e2b_session_env).toHaveBeenCalledTimes(3);
    expect(create_e2b_session_env.mock.calls[2]?.[0]?.volume).toBeUndefined();

    await expect(
      workspace.environment.write_file?.('notes.md', 'would not survive'),
    ).rejects.toThrow(/storage could not be attached/i);
  });
});
