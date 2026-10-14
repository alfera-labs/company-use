import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  create_runtime_environment,
  find_runtime_environment_by_mount_key,
  upsert_sandbox_by_mount_key,
} from '@coworker/core/db/queries/sessions';
import type {
  OpenCodingWorkspaceInput,
  WorkspaceRuntimeProvider,
} from '@runtime-platform/orchestrator/workspace_runtime';
import type { OpenVolume } from '@runtime-platform/storage/volume_runtime';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';

export async function find_or_create_runtime_environment(
  db: Database,
  input: OpenCodingWorkspaceInput & {
    provider: WorkspaceRuntimeProvider;
    workspace_mount_key: string;
    host_workspace_root: string;
    volume?: OpenVolume;
  },
) {
  const existing = await find_runtime_environment_by_mount_key(db, {
    workspace_id: input.workspace_id,
    environment_provider: input.provider,
    workspace_mount_key: input.workspace_mount_key,
  });
  if (existing) return existing;

  return create_runtime_environment(db, {
    workspace_id: input.workspace_id,
    session_id: input.volume ? null : input.session_id,
    agent_id: input.volume ? null : input.agent_id,
    environment_provider: input.provider,
    environment_status: 'pending',
    workspace_mount_key: input.workspace_mount_key,
    root_path:
      input.provider === 'local' ? input.host_workspace_root : current_workspace_layout.model_root,
    environment_metadata: { host_workspace_root: input.host_workspace_root },
    actor_id: input.actor_id,
  });
}

export async function find_or_create_e2b_sandbox(
  db: Database,
  input: OpenCodingWorkspaceInput & {
    provider: 'e2b';
    runtime_environment_id: string;
    workspace_mount_key: string;
    host_workspace_root: string;
    volume?: OpenVolume;
  },
) {
  return upsert_sandbox_by_mount_key(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    agent_id: input.agent_id,
    runtime_environment_id: input.runtime_environment_id,
    sandbox_provider: input.provider,
    sandbox_status: 'starting',
    provider_template_id: env.COWORKER_E2B_TEMPLATE_ID,
    workspace_mount_key: input.workspace_mount_key,
    root_path: current_workspace_layout.model_root,
    working_directory: current_workspace_layout.model_root,
    sandbox_metadata: { host_workspace_root: input.host_workspace_root },
    actor_id: input.actor_id,
  });
}
