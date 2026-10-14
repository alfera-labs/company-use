import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import type { ModelRootName } from '@agent-core/environment/memory_root_path';
import {
  memory_root_index_path,
  memory_root_model_path,
  memory_root_relative_path,
  model_root_of,
  open_scope_slug_of,
} from '@agent-core/environment/memory_root_path';
import { PathLeavesRootsError } from '@agent-core/environment/open_inside_roots';
import { create_scratch_mount } from '@agent-core/environment/scratch_mount';
import {
  assert_path_inside_workspace,
  is_path_inside,
  workspace_path_escape_message,
} from '@agent-core/environment/workspace_path_escape';

const model_workspace_root = '/workspace';

type LocalRoots = {
  workspace_root: string;
  scratch: ReturnType<typeof create_scratch_mount>;
  memory_root: string | undefined;
  read_open_slugs: () => ReadonlySet<string>;
};

/**
 * Host-path mapping for the local provider. `/workspace/...` and relative paths resolve under
 * the workspace root. `/memory/<open slug>/...` resolves under the memory root directory; any
 * other `/memory` path throws the workspace escape message. A scratch root backs the workspace's
 * `tmp/` folder with another directory, so sessions that share a workspace keep their own scratch.
 */
export function create_local_session_paths(input: {
  workspace_root: string;
  scratch_root?: string | undefined;
  memory_root_directory: string | undefined;
  read_open_slugs: () => ReadonlySet<string>;
}) {
  const roots: LocalRoots = {
    workspace_root: input.workspace_root,
    scratch: create_scratch_mount(input.workspace_root, input.scratch_root),
    memory_root: input.memory_root_directory
      ? realpathSync(path.resolve(input.memory_root_directory))
      : undefined,
    read_open_slugs: input.read_open_slugs,
  };
  return {
    resolve_safe_path: (workspace_path = '.') => resolve_local_path(roots, workspace_path),
    resolve_safe_absolute_path: (absolute_path: string) =>
      resolve_inside(roots.workspace_root, path.resolve(absolute_path), absolute_path),
    assert_real_path_inside_workspace: (absolute_path: string, workspace_path: string) =>
      assert_real_path_inside_root(roots, absolute_path, workspace_path),
    inside_workspace: <T>(workspace_path: string, use: UsePathInsideRoots<T>) =>
      use_path_inside_roots(roots, workspace_path, use),
    to_workspace_path: (absolute_path: string) => to_model_path(roots, absolute_path),
    to_backing_path: (absolute_path: string) => roots.scratch.backing_path(absolute_path),
  };
}

const glob_search_root_by_root = {
  memory: (pattern: string) =>
    path.posix.join(memory_root_model_path, open_scope_slug_of(pattern) ?? ''),
  workspace: () => '.',
} satisfies Record<ModelRootName, (pattern: string) => string>;

/** The folder a glob walks: the open scope folder for a `/memory` pattern, else the workspace. */
export function glob_search_root(pattern: string) {
  return glob_search_root_by_root[model_root_of(pattern).name](pattern);
}

const resolve_local_path_by_root = {
  memory: (roots: LocalRoots, workspace_path: string) => {
    if (!roots.memory_root) throw new Error(workspace_path_escape_message(workspace_path));
    const relative_path = memory_root_relative_path(workspace_path, roots.read_open_slugs());
    return path.resolve(roots.memory_root, relative_path);
  },
  workspace: (roots: LocalRoots, workspace_path: string) => {
    const relative_path = normalize_workspace_path(workspace_path);
    return roots.scratch.backing_path(
      resolve_inside(
        roots.workspace_root,
        path.resolve(roots.workspace_root, relative_path),
        workspace_path,
      ),
    );
  },
} satisfies Record<ModelRootName, (roots: LocalRoots, workspace_path: string) => string>;

function resolve_local_path(roots: LocalRoots, workspace_path: string) {
  return resolve_local_path_by_root[model_root_of(workspace_path).name](roots, workspace_path);
}

function resolve_inside(root: string, resolved: string, given_path: string) {
  assert_path_inside_workspace(root, resolved, given_path);
  return resolved;
}

const allowed_roots_by_root = {
  memory: (roots: LocalRoots, workspace_path: string) => {
    if (!roots.memory_root) return [roots.workspace_root];
    if (path.posix.normalize(workspace_path) === memory_root_index_path) return [roots.memory_root];
    return [path.join(roots.memory_root, open_scope_slug_of(workspace_path) ?? '')];
  },
  workspace: (roots: LocalRoots) => roots.scratch.reachable_roots,
} satisfies Record<ModelRootName, (roots: LocalRoots, workspace_path: string) => string[]>;

function allowed_roots_of(roots: LocalRoots, workspace_path: string) {
  return allowed_roots_by_root[model_root_of(workspace_path).name](roots, workspace_path);
}

function symlink_escapes_workspace(workspace_path: string) {
  return new Error(`Symlink escapes workspace: ${workspace_path}`);
}

async function assert_real_path_inside_root(
  roots: LocalRoots,
  absolute_path: string,
  workspace_path: string,
) {
  const real_path = await fs.realpath(absolute_path);
  const is_inside = allowed_roots_of(roots, workspace_path).some((allowed_root) =>
    is_path_inside(allowed_root, real_path),
  );
  if (!is_inside) throw symlink_escapes_workspace(workspace_path);
}

type UsePathInsideRoots<T> = (
  allowed_roots: readonly string[],
  absolute_path: string,
) => Promise<T>;

async function use_path_inside_roots<T>(
  roots: LocalRoots,
  workspace_path: string,
  use: UsePathInsideRoots<T>,
) {
  const absolute_path = resolve_local_path(roots, workspace_path);
  try {
    return await use(allowed_roots_of(roots, workspace_path), absolute_path);
  } catch (error) {
    if (error instanceof PathLeavesRootsError) throw symlink_escapes_workspace(workspace_path);
    throw error;
  }
}

function to_model_path(roots: LocalRoots, absolute_path: string) {
  if (roots.memory_root && absolute_path.startsWith(`${roots.memory_root}${path.sep}`)) {
    const relative = path.relative(roots.memory_root, absolute_path).split(path.sep).join('/');
    return path.posix.join(memory_root_model_path, relative);
  }
  const relative = path.relative(roots.workspace_root, roots.scratch.workspace_path(absolute_path));
  return relative === '' ? '.' : relative.split(path.sep).join('/');
}

function normalize_workspace_path(workspace_path: string) {
  if (workspace_path === model_workspace_root) return '.';
  if (workspace_path.startsWith(`${model_workspace_root}/`)) {
    return workspace_path.slice(model_workspace_root.length + 1);
  }
  return workspace_path;
}
