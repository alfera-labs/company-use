import path from 'node:path';
import { workspace_path_escape_message } from '@agent-core/environment/workspace_path_escape';
import {
  e2b_workspace_root,
  quote_shell_argument,
} from '@runtime-platform/orchestrator/e2b_command';
import type { ModelRootName } from '@runtime-platform/storage/memory_root';
import {
  is_memory_root_path,
  memory_root_sandbox_path,
  model_root_of,
} from '@runtime-platform/storage/memory_root';

/** The open slug set of a caller that has no memory run: every `/memory` path is refused. */
export const no_open_memory_slugs: ReadonlySet<string> = new Set();

const sandbox_path_by_root = {
  memory: (raw_path: string, open_slugs: ReadonlySet<string>) =>
    memory_root_sandbox_path(raw_path, open_slugs),
  workspace: (raw_path: string) => {
    if (raw_path === e2b_workspace_root) return e2b_workspace_root;
    if (raw_path.startsWith(`${e2b_workspace_root}/`)) {
      return normalize_absolute_e2b_path(raw_path);
    }
    if (raw_path.startsWith('/')) throw new Error(workspace_path_escape_message(raw_path));
    return normalize_absolute_e2b_path(path.posix.join(e2b_workspace_root, raw_path));
  },
} satisfies Record<ModelRootName, (raw_path: string, open_slugs: ReadonlySet<string>) => string>;

/** The absolute sandbox path for a canonical tool path. Throws the escape message off the roots. */
export function e2b_path(workspace_path: string, open_slugs: ReadonlySet<string>) {
  const raw_path = workspace_path.trim() || '.';
  return sandbox_path_by_root[model_root_of(raw_path).name](raw_path, open_slugs);
}

const sandbox_cwd_by_root = {
  memory: (cwd: string, open_slugs: ReadonlySet<string>) =>
    memory_root_sandbox_path(cwd, open_slugs),
  workspace: (cwd: string) => {
    if (cwd === e2b_workspace_root || cwd.startsWith(`${e2b_workspace_root}/`)) {
      return normalize_absolute_e2b_path(cwd);
    }
    if (cwd.startsWith('/')) return path.posix.normalize(cwd);
    return normalize_absolute_e2b_path(path.posix.join(e2b_workspace_root, cwd));
  },
} satisfies Record<ModelRootName, (cwd: string, open_slugs: ReadonlySet<string>) => string>;

/** The sandbox working directory for a command. Other absolute paths pass; closed memory paths throw. */
export function e2b_cwd(cwd: string, open_slugs: ReadonlySet<string>) {
  return sandbox_cwd_by_root[model_root_of(cwd).name](cwd, open_slugs);
}

export function path_is_on_workspace_volume(candidate_path: string) {
  if (!candidate_path.startsWith('/')) return true;
  const normalized_path = path.posix.normalize(candidate_path);
  return (
    normalized_path === e2b_workspace_root || normalized_path.startsWith(`${e2b_workspace_root}/`)
  );
}

/**
 * Sort a command's declared writable paths by where they live. Only `volume_paths` take Archil
 * ownership. `memory_root_paths` are open scope folders on sandbox-local disk. A closed memory path
 * throws the escape message; any other off-volume path is ignored.
 */
export function split_writable_paths(
  writable_paths: readonly string[],
  open_slugs: ReadonlySet<string>,
) {
  const memory_root_paths = writable_paths
    .filter(is_memory_root_path)
    .map((writable_path) => memory_root_sandbox_path(writable_path, open_slugs));
  const other_paths = writable_paths.filter((writable_path) => !is_memory_root_path(writable_path));
  return {
    volume_paths: other_paths
      .filter(path_is_on_workspace_volume)
      .map((writable_path) => e2b_path(writable_path, open_slugs)),
    memory_root_paths,
    ignored_paths: other_paths.filter(
      (writable_path) => !path_is_on_workspace_volume(writable_path),
    ),
  };
}

const model_path_from_sandbox_by_root = {
  memory: (absolute_path: string) => path.posix.normalize(absolute_path),
  workspace: (absolute_path: string) => {
    const normalized_path = normalize_absolute_e2b_path(absolute_path);
    if (normalized_path === e2b_workspace_root) return '.';
    return normalized_path.slice(e2b_workspace_root.length + 1);
  },
} satisfies Record<ModelRootName, (absolute_path: string) => string>;

/** The model path for an absolute sandbox path: workspace-relative, or `/memory/...` as is. */
export function relative_e2b_path(absolute_path: string) {
  return model_path_from_sandbox_by_root[model_root_of(absolute_path).name](absolute_path);
}

export function glob_shell_command(
  pattern: string,
  max_results: number,
  open_slugs: ReadonlySet<string> = no_open_memory_slugs,
) {
  const search = find_glob_search(pattern, open_slugs);
  const target = quote_shell_argument(search.target);
  return [`find -L ${search.root} -path ${target} -print`, `head -n ${max_results}`].join(' | ');
}

const glob_search_by_root = {
  memory: (pattern: string, open_slugs: ReadonlySet<string>) => {
    const target = path.posix.normalize(pattern);
    const scope_folder = target.split('/').slice(0, 3).join('/');
    return {
      root: quote_shell_argument(memory_root_sandbox_path(scope_folder, open_slugs)),
      target,
    };
  },
  workspace: (pattern: string) => ({
    root: e2b_workspace_root,
    target: path.posix.join(e2b_workspace_root, pattern),
  }),
} satisfies Record<
  ModelRootName,
  (pattern: string, open_slugs: ReadonlySet<string>) => { root: string; target: string }
>;

function find_glob_search(pattern: string, open_slugs: ReadonlySet<string>) {
  return glob_search_by_root[model_root_of(pattern).name](pattern, open_slugs);
}

function normalize_absolute_e2b_path(absolute_path: string) {
  const normalized_path = path.posix.normalize(absolute_path);
  if (
    normalized_path !== e2b_workspace_root &&
    !normalized_path.startsWith(`${e2b_workspace_root}/`)
  ) {
    throw new Error(`Path escapes workspace: ${absolute_path}`);
  }
  return normalized_path;
}
