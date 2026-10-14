import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_runtime_environment,
  create_session,
  find_sandbox_by_mount_key,
  get_runtime_environment,
  upsert_sandbox_by_mount_key,
} from '@coworker/core/db/queries/sessions';
import { create_volume, find_volume } from '@coworker/core/db/queries/volumes';
import { mark_coding_workspace_idle } from '@runtime-platform/orchestrator/workspace_runtime';
import { expect, it, vi } from 'vitest';

const e2b_mocks = vi.hoisted(() => ({
  stop_e2b_sandbox: vi.fn(async () => ({ volume_synced: false })),
}));

vi.mock('@runtime-platform/orchestrator/e2b_sandbox_client', async (import_original) => ({
  ...(await import_original<typeof import('@runtime-platform/orchestrator/e2b_sandbox_client')>()),
  stop_e2b_sandbox: e2b_mocks.stop_e2b_sandbox,
}));

it('releases a missing E2B sandbox without recording a false Archil sync', async () => {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Missing E2B close test',
    actor_id: bootstrap.user_id,
  });
  const volume = await create_volume(db, {
    workspace_id: bootstrap.workspace_id,
    volume_provider: 'archil',
    workspace_layout_version: 2,
    volume_status: 'active',
    provider_volume_id: 'dsk_missing_e2b',
    provider_region: 'aws-us-west-2',
    actor_id: bootstrap.user_id,
  });
  const workspace_mount_key = `workspace:${bootstrap.workspace_id}:${session.session_id}`;
  const runtime_environment = await create_runtime_environment(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    environment_provider: 'e2b',
    environment_status: 'running',
    provider_environment_id: 'sbox_missing',
    workspace_mount_key,
    root_path: '/work',
    environment_metadata: {
      volume_id: volume.volume_id,
      volume_provider: 'archil',
      volume_root_path: '/mnt/coworker',
    },
    actor_id: bootstrap.user_id,
  });
  await upsert_sandbox_by_mount_key(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_id: session.session_id,
    runtime_environment_id: runtime_environment.runtime_environment_id,
    sandbox_provider: 'e2b',
    sandbox_status: 'running',
    provider_sandbox_id: 'sbox_missing',
    workspace_mount_key,
    root_path: '/work',
    working_directory: '/work/repo',
    actor_id: bootstrap.user_id,
  });

  await expect(
    mark_coding_workspace_idle(db, {
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
      close_token: { provider_environment_id: 'sbox_missing' },
      actor_id: bootstrap.user_id,
    }),
  ).resolves.toMatchObject({ environment_status: 'idle' });

  expect(e2b_mocks.stop_e2b_sandbox).toHaveBeenCalledOnce();
  await expect(find_volume(db, bootstrap.workspace_id)).resolves.toMatchObject({
    volume_status: 'active',
    last_error_code: null,
  });
  await expect(
    find_sandbox_by_mount_key(db, {
      workspace_id: bootstrap.workspace_id,
      sandbox_provider: 'e2b',
      workspace_mount_key,
    }),
  ).resolves.toMatchObject({ sandbox_status: 'stopped' });
  await expect(
    get_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
    }),
  ).resolves.toMatchObject({ environment_status: 'idle' });
});
