import path from 'node:path';
import { create_local_session_env } from '@agent-core/environment';
import type { Database } from '@coworker/core';
import { create_browser_state_config } from '@runtime-platform/browser/browser_state_config';
import { create_docker_session_env } from '@runtime-platform/orchestrator/docker_workspace';
import {
  connect_e2b_session_env,
  create_e2b_session_env,
} from '@runtime-platform/orchestrator/e2b_sandbox_client';
import {
  generate_sandbox_network_rules,
  type SandboxNetworkRules,
} from '@runtime-platform/orchestrator/sandbox_credential_headers';
import { workspace_directories_for_layout } from '@runtime-platform/orchestrator/workspace_host_paths';
import type { WorkspaceLocation } from '@runtime-platform/orchestrator/workspace_location';
import { prepare_workspace_memory_root_directory } from '@runtime-platform/orchestrator/workspace_memory_root';
import type { WorkspaceRuntimeProvider } from '@runtime-platform/orchestrator/workspace_runtime';
import type { OpenVolume } from '@runtime-platform/storage/volume_runtime';
import {
  current_workspace_layout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';

async function create_local_workspace_environment(
  runtime_environment_id: string,
  input: WorkspaceLocation,
) {
  const memory_root_directory = await prepare_workspace_memory_root_directory(
    input.host_workspace_root,
  );
  return create_local_session_env({
    env_key: input.workspace_mount_key,
    workspace_root: input.host_workspace_root,
    ...(input.host_scratch_root ? { scratch_root: input.host_scratch_root } : {}),
    working_directory: input.host_workspace_root,
    command_env: create_host_workspace_command_env(input.host_workspace_root),
    memory_root_directory,
    metadata: {
      runtime_environment_id,
      environment_provider: 'local',
      workspace_mount_key: input.workspace_mount_key,
      workspace_dir: input.host_workspace_root,
      host_workspace_root: input.host_workspace_root,
      model_workspace_root: current_workspace_layout.model_root,
      model_working_directory: current_workspace_layout.model_root,
      workspace_layout_version: current_workspace_layout.layout_version,
      agent_tools_address_files_by: 'working_directory_relative_path' as const,
    },
  });
}

function create_host_workspace_command_env(host_workspace_root: string) {
  return {
    ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
    HOME: host_workspace_root,
    TMPDIR: path.join(host_workspace_root, 'tmp'),
    USER: 'coworker',
    LOGNAME: 'coworker',
    SHELL: '/bin/bash',
    LANG: process.env.LANG ?? 'C.UTF-8',
    COWORKER_WORKSPACE_ROOT: current_workspace_layout.model_root,
    COWORKER_HOST_WORKSPACE_ROOT: host_workspace_root,
  };
}

export async function workspace_credential_headers(
  db: Database,
  provider: WorkspaceRuntimeProvider,
  workspace_id: string,
): Promise<{ network_rules?: SandboxNetworkRules }> {
  if (provider !== 'e2b') return {};
  const network_rules = await generate_sandbox_network_rules({ db, workspace_id });
  return network_rules ? { network_rules } : {};
}

type E2bWorkspaceEnvironmentInput = {
  host_workspace_root: string;
  workspace_mount_key: string;
  run_id: string;
  agent_id: string;
  provider_sandbox_id?: string;
  browser_sandbox_id?: string;
  volume?: OpenVolume;
  on_sandbox_created?: (provider_sandbox_id: string) => Promise<void>;
  network_rules?: SandboxNetworkRules;
};

async function create_e2b_workspace_environment(
  runtime_environment_id: string,
  input: E2bWorkspaceEnvironmentInput,
) {
  const environment_input = {
    runtime_environment_id,
    workspace_mount_key: input.workspace_mount_key,
    ...(input.provider_sandbox_id ? { sandbox_id: input.provider_sandbox_id } : {}),
    run_id: input.run_id,
    agent_id: input.agent_id,
    host_workspace_root: input.host_workspace_root,
    workspace_directories: workspace_directories_for_layout(
      workspace_layout_for_version(input.volume?.workspace_layout_version),
    ),
    ...(input.volume
      ? {
          command_env: create_browser_state_config({
            volume_id: input.volume.volume_id,
          }).command_env,
        }
      : {}),
    ...(input.volume ? { volume: input.volume } : {}),
    ...(input.on_sandbox_created ? { on_sandbox_created: input.on_sandbox_created } : {}),
    ...(input.network_rules ? { network_rules: input.network_rules } : {}),
  };
  if (input.browser_sandbox_id) {
    const connected = await connect_e2b_session_env({
      ...environment_input,
      sandbox_id: input.browser_sandbox_id,
    });
    if (connected) return connected;
    delete environment_input.sandbox_id;
  }
  return create_e2b_session_env(environment_input);
}

export async function create_workspace_environment(
  provider: WorkspaceRuntimeProvider,
  runtime_environment_id: string,
  input: WorkspaceLocation & {
    run_id: string;
    agent_id: string;
    provider_sandbox_id?: string;
    browser_sandbox_id?: string;
    actor_id: string;
    volume?: OpenVolume;
    on_sandbox_created?: (provider_sandbox_id: string) => Promise<void>;
    network_rules?: SandboxNetworkRules;
  },
) {
  if (provider === 'docker') {
    return create_docker_session_env(
      await create_local_workspace_environment(runtime_environment_id, input),
      input,
    );
  }

  if (provider === 'e2b') {
    return create_e2b_workspace_environment(runtime_environment_id, input);
  }

  return create_local_workspace_environment(runtime_environment_id, {
    host_workspace_root: input.host_workspace_root,
    workspace_mount_key: input.workspace_mount_key,
  });
}
