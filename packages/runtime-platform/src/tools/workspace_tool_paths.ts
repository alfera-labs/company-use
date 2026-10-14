import path from 'node:path';
import { workspace_path_escape_message } from '@agent-core/environment/workspace_path_escape';
import type { RuntimeToolContext } from '@agent-core/tools/runtime_tool';
import { e2b_workspace_root } from '@runtime-platform/orchestrator/e2b_command';
import type { ModelRootName } from '@runtime-platform/storage/memory_root';
import { model_root_of } from '@runtime-platform/storage/memory_root';
import {
  model_may_write_workspace_path,
  type WorkspaceLayout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';
import { err } from '@runtime-platform/tools/workspace_tool_results';

const workspace_root = e2b_workspace_root;

export function require_workspace_environment(context: RuntimeToolContext) {
  if (!context.environment) throw new Error('sandbox_unavailable');
  return context.environment;
}

const path_is_reserved_by_root = {
  memory: () => false,
  workspace: (workspace_path: string, layout: WorkspaceLayout) =>
    !model_may_write_workspace_path(workspace_path, layout),
} satisfies Record<ModelRootName, (workspace_path: string, layout: WorkspaceLayout) => boolean>;

export function reserved_path_refusal(workspace_path: string, layout: WorkspaceLayout) {
  const root = model_root_of(workspace_path).name;
  if (!path_is_reserved_by_root[root](workspace_path, layout)) {
    return undefined;
  }
  return err(
    'reserved_workspace_path',
    `${workspace_path} is written for you by the platform and is read-only. Read it freely; write your own notes somewhere else in the workspace.`,
  );
}

export function workspace_layout_in(context: RuntimeToolContext) {
  return workspace_layout_for_version(
    require_workspace_environment(context).metadata?.workspace_layout_version,
  );
}

const canonicalize_by_root = {
  memory: (workspace_path: string) => path.posix.normalize(workspace_path),
  workspace: (workspace_path: string) => {
    if (
      workspace_path.startsWith('/') &&
      workspace_path !== workspace_root &&
      !workspace_path.startsWith(`${workspace_root}/`)
    ) {
      throw new Error(workspace_path_escape_message(workspace_path));
    }

    const without_workspace_root =
      workspace_path === workspace_root
        ? '.'
        : workspace_path.startsWith(`${workspace_root}/`)
          ? workspace_path.slice(workspace_root.length + 1)
          : workspace_path;
    const normalized = path.posix.normalize(without_workspace_root.replace(/\\/g, '/'));
    if (normalized === '..' || normalized.startsWith('../')) {
      throw new Error(workspace_path_escape_message(workspace_path));
    }
    if (normalized === '.' || normalized === '') return '.';
    return normalized.replace(/^\/+/, '');
  },
} satisfies Record<ModelRootName, (workspace_path: string) => string>;

function canonical_workspace_path(workspace_path: string) {
  return canonicalize_by_root[model_root_of(workspace_path).name](workspace_path);
}

export function canonical_workspace_file_path(workspace_path: string) {
  return canonical_workspace_path(workspace_path);
}

export function canonical_shell_working_directory(cwd: string | undefined) {
  if (cwd === undefined) return '.';
  if (cwd.startsWith('/') && cwd !== workspace_root && !cwd.startsWith(`${workspace_root}/`)) {
    return cwd;
  }
  return canonical_workspace_file_path(cwd);
}

export function canonical_workspace_glob_pattern(pattern: string) {
  const first_segment = pattern.split('/')[0] ?? '';
  if (/[*?[]/u.test(first_segment)) return pattern;
  return canonical_workspace_file_path(pattern);
}

const absolute_path_by_root = {
  memory: (workspace_path: string) => workspace_path,
  workspace: (workspace_path: string) => path.posix.join(e2b_workspace_root, workspace_path),
} satisfies Record<ModelRootName, (workspace_path: string) => string>;

export function absolute_workspace_path(workspace_path: string) {
  return absolute_path_by_root[model_root_of(workspace_path).name](workspace_path);
}
