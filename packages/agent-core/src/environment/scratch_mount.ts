import { realpathSync } from 'node:fs';
import path from 'node:path';
import { is_path_inside } from '@agent-core/environment/workspace_path_escape';

export const scratch_folder_name = 'tmp';

/**
 * Backs the workspace's scratch folder with another directory on the host, the way a nested
 * bind mount does inside a container. With no scratch root every path maps to itself.
 */
export function create_scratch_mount(workspace_root: string, scratch_root: string | undefined) {
  const mount_point = path.join(workspace_root, scratch_folder_name);
  const backing_root = scratch_root ? realpathSync(path.resolve(scratch_root)) : mount_point;
  const move = (from: string, to: string, absolute_path: string) =>
    is_path_inside(from, absolute_path)
      ? path.join(to, path.relative(from, absolute_path))
      : absolute_path;
  return {
    backing_path: (workspace_path: string) => move(mount_point, backing_root, workspace_path),
    workspace_path: (backing_path: string) => move(backing_root, mount_point, backing_path),
    reachable_roots: [workspace_root, backing_root],
  };
}
