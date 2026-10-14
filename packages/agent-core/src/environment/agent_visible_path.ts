import path from 'node:path';
import type { ModelRootName } from '@agent-core/environment/memory_root_path';
import { model_root_of } from '@agent-core/environment/memory_root_path';
import type { SessionEnv } from '@agent-core/environment/session_env';

export type AgentPathStyle = 'workspace_absolute_path' | 'working_directory_relative_path';

const default_model_workspace_root = '/workspace';
const default_agent_path_style: AgentPathStyle = 'workspace_absolute_path';

const format_agent_visible_path = {
  workspace_absolute_path: (workspace_path: string, _cwd: string, workspace_root: string) =>
    path.posix.join(workspace_root, workspace_path),
  working_directory_relative_path: (
    workspace_path: string,
    working_directory: string,
    workspace_root: string,
  ) => path.posix.relative(working_directory, path.posix.join(workspace_root, workspace_path)),
} as const satisfies Record<
  AgentPathStyle,
  (workspace_path: string, cwd: string, workspace_root: string) => string
>;

export function find_agent_path_style(environment: SessionEnv | undefined): AgentPathStyle {
  const declared = environment?.metadata?.agent_tools_address_files_by;
  return declared ?? default_agent_path_style;
}

function agent_visible_workspace_path(environment: SessionEnv | undefined, workspace_path: string) {
  const canonical_path = workspace_path.replace(/^\/+/u, '');
  const declared_root = environment?.metadata?.model_workspace_root;
  const workspace_root =
    typeof declared_root === 'string' && declared_root
      ? declared_root
      : default_model_workspace_root;
  const style = find_agent_path_style(environment);
  if (style === 'workspace_absolute_path') {
    return format_agent_visible_path.workspace_absolute_path(canonical_path, '', workspace_root);
  }
  const declared_working_directory = environment?.metadata?.model_working_directory;
  const working_directory =
    typeof declared_working_directory === 'string' && declared_working_directory
      ? declared_working_directory
      : workspace_root;
  return format_agent_visible_path.working_directory_relative_path(
    canonical_path,
    working_directory,
    workspace_root,
  );
}

const agent_visible_path_by_root = {
  memory: (_environment: SessionEnv | undefined, workspace_path: string) =>
    path.posix.normalize(workspace_path),
  workspace: agent_visible_workspace_path,
} satisfies Record<
  ModelRootName,
  (environment: SessionEnv | undefined, workspace_path: string) => string
>;

export function generate_agent_visible_path(
  environment: SessionEnv | undefined,
  workspace_path: string,
) {
  return agent_visible_path_by_root[model_root_of(workspace_path).name](
    environment,
    workspace_path,
  );
}
