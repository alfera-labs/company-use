import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { env } from '@coworker/config';
import {
  current_workspace_layout,
  volume_workspace_path,
  type WorkspaceLayout,
} from '@runtime-platform/storage/workspace_layouts';

type HostWorkspaceOwner = {
  workspace_id: string;
  agent_id: string;
  workspace_base_path?: string;
};

export type HostWorkspaceAddress = {
  host_workspace_root: string;
  layout: WorkspaceLayout;
};

export function host_workspace_base_path(workspace_base_path?: string) {
  return (
    workspace_base_path ??
    env.COWORKER_WORKSPACE_BASE_PATH ??
    path.join(homedir(), '.coworker/workspaces')
  );
}

/**
 * The one folder every docker session of a workspace shares, laid out like the cloud volume:
 * `<base>/<workspace_id>/volume/agents/<agent_id>/workspace`.
 */
export function host_workspace_root_path(owner: HostWorkspaceOwner) {
  return path.join(
    host_workspace_base_path(owner.workspace_base_path),
    path_segment(owner.workspace_id),
    'volume',
    volume_workspace_path(owner.agent_id),
  );
}

/** The scratch only one session sees: `<base>/<workspace_id>/<session_id>/tmp`. */
export function host_session_scratch_path(session: {
  workspace_id: string;
  session_id: string;
  workspace_base_path?: string;
}) {
  return path.join(
    host_workspace_base_path(session.workspace_base_path),
    path_segment(session.workspace_id),
    path_segment(session.session_id),
    'tmp',
  );
}

/**
 * Where a workspace's files are on this machine. Null on every provider but docker, and null
 * before the workspace's first docker run made the folder.
 */
export async function find_host_workspace_address(
  owner: HostWorkspaceOwner & { workspace_runtime_provider?: 'local' | 'docker' | 'e2b' },
): Promise<HostWorkspaceAddress | null> {
  const provider = owner.workspace_runtime_provider ?? env.COWORKER_WORKSPACE_RUNTIME_PROVIDER;
  if (provider !== 'docker') return null;
  const host_workspace_root = host_workspace_root_path(owner);
  try {
    const folder = await fs.stat(host_workspace_root);
    return folder.isDirectory() ? { host_workspace_root, layout: current_workspace_layout } : null;
  } catch (error) {
    if (is_no_file_error(error)) return null;
    throw error;
  }
}

/** True when the disk says there is no file at that path: nothing is there, or a folder is. */
export function is_no_file_error(error: unknown) {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

function path_segment(id: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error(`Id is not usable as a path segment: ${id}`);
  return id;
}
