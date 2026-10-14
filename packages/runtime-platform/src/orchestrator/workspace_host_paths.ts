import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '@coworker/config';
import type { WorkspaceRuntimeProvider } from '@runtime-platform/orchestrator/workspace_runtime';
import { host_workspace_base_path } from '@runtime-platform/storage/host_volume';
import {
  current_workspace_layout,
  type WorkspaceLayout,
} from '@runtime-platform/storage/workspace_layouts';

export function workspace_directories_for_layout(layout: WorkspaceLayout) {
  return layout.folders.map((folder) => folder.path);
}

export const workspace_directories = workspace_directories_for_layout(current_workspace_layout);

export async function prepare_host_workspace(host_workspace_root: string, run_id: string) {
  await Promise.all(
    [...workspace_directories, path.join('tmp', run_id), '.coworker'].map((directory) =>
      fs.mkdir(path.join(host_workspace_root, directory), { recursive: true }),
    ),
  );
  return fs.realpath(host_workspace_root);
}

export function workspace_root_path(input: {
  workspace_base_path?: string;
  workspace_id: string;
  session_id: string;
}) {
  const base_path = host_workspace_base_path(input.workspace_base_path);
  return path.join(base_path, input.workspace_id, input.session_id, 'work');
}

export function default_workspace_runtime_provider(): WorkspaceRuntimeProvider {
  return env.COWORKER_WORKSPACE_RUNTIME_PROVIDER;
}
