import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  create_folder_inside_roots,
  PathLeavesRootsError,
} from '@agent-core/environment/open_inside_roots';
import { scratch_folder_name } from '@agent-core/environment/scratch_mount';
import {
  prepare_host_workspace,
  workspace_root_path,
} from '@runtime-platform/orchestrator/workspace_host_paths';
import type {
  OpenCodingWorkspaceInput,
  WorkspaceRuntimeProvider,
} from '@runtime-platform/orchestrator/workspace_runtime';
import {
  host_session_scratch_path,
  host_workspace_root_path,
} from '@runtime-platform/storage/host_volume';
import { type OpenVolume, volume_mount_key } from '@runtime-platform/storage/volume_runtime';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';

export type WorkspaceLocation = {
  workspace_mount_key: string;
  host_workspace_root: string;
  host_scratch_root?: string;
};

type WorkspaceRun = Pick<
  OpenCodingWorkspaceInput,
  'workspace_id' | 'session_id' | 'agent_id' | 'run_id' | 'workspace_base_path'
>;

export const session_home_folder = 'home';

/**
 * Where a run's workspace is. A volume answers first. On docker every session of a workspace
 * shares one folder on this machine and keeps its own scratch. Otherwise each session has a folder.
 */
export async function locate_coding_workspace(
  input: WorkspaceRun,
  provider: WorkspaceRuntimeProvider,
  volume: OpenVolume | undefined,
): Promise<WorkspaceLocation> {
  if (volume)
    return {
      workspace_mount_key: volume.workspace_mount_key,
      host_workspace_root: current_workspace_layout.model_root,
    };
  if (provider === 'docker') return open_shared_host_workspace(input);
  return {
    workspace_mount_key: `${input.workspace_id}:${input.session_id}`,
    host_workspace_root: await prepare_host_workspace(workspace_root_path(input), input.run_id),
  };
}

async function open_shared_host_workspace(input: WorkspaceRun): Promise<WorkspaceLocation> {
  const host_workspace_root = await create_real_folder(host_workspace_root_path(input));
  const host_scratch_root = await create_real_folder(host_session_scratch_path(input));
  const roots = [host_workspace_root, host_scratch_root];
  const folders = [
    ...current_workspace_layout.folders.map((folder) =>
      path.join(host_workspace_root, folder.path),
    ),
    path.join(host_workspace_root, scratch_folder_name),
    path.join(host_scratch_root, input.run_id),
    path.join(host_scratch_root, session_home_folder),
  ];
  await Promise.all(folders.map((folder) => create_workspace_folder(roots, folder)));
  return {
    workspace_mount_key: volume_mount_key(input.workspace_id, input.session_id),
    host_workspace_root,
    host_scratch_root,
  };
}

async function create_real_folder(folder: string) {
  await fs.mkdir(folder, { recursive: true });
  return fs.realpath(folder);
}

async function create_workspace_folder(roots: readonly string[], folder: string) {
  try {
    await create_folder_inside_roots(roots, folder);
  } catch (error) {
    if (!(error instanceof PathLeavesRootsError)) throw error;
    throw new Error(`A workspace folder is a link that leaves the workspace: ${folder}`);
  }
}
