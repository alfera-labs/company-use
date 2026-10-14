import type { RuntimeToolContext } from '@agent-core/tools/runtime_tool';
import { is_memory_root_path } from '@runtime-platform/storage/memory_root';
import {
  type WorkspaceLayout,
  workspace_path_is_durable,
} from '@runtime-platform/storage/workspace_layouts';
import { workspace_layout_in } from '@runtime-platform/tools/workspace_tool_paths';

const kind_by_produced_folder = [
  ['system/tool-output', 'log'],
  ['files', 'file'],
  ['artifacts', 'file'],
  ['screenshots', 'screenshot'],
  ['downloads', 'download'],
  ['logs', 'log'],
] as const;

const pages_the_platform_keeps_at_the_root = ['README.md', 'WORKSPACE.md'];

export type WrittenWorkspace = {
  layout: WorkspaceLayout;
  is_on_this_machine: boolean;
};

/**
 * The kind of file record a written workspace path gets, or undefined when it gets none.
 * A path in a folder for produced files always gets one. Where the workspace is a folder on
 * this machine and this platform laid it out, every other path gets one too, unless the layout
 * gives the place another job: a folder the layout names (memory, procedures, system), `tmp/`,
 * a hidden path, or a page kept at the root. A workspace in a remote sandbox keeps the first
 * rule alone: a record there costs a read from the sandbox for each write.
 */
export function produced_file_kind(workspace_path: string, workspace: WrittenWorkspace) {
  const produced_folder = kind_by_produced_folder.find(([folder]) =>
    workspace_path.startsWith(`${folder}/`),
  );
  if (produced_folder) return produced_folder[1];
  const { layout } = workspace;
  if (!workspace.is_on_this_machine || !layout.platform_lays_out_workspace) return undefined;
  return layout_gives_the_path_another_job(workspace_path, layout) ? undefined : 'file';
}

/** The workspace a tool call writes into: its layout, and whether it is a folder on this machine. */
export function workspace_written_in(context: RuntimeToolContext): WrittenWorkspace {
  return {
    layout: workspace_layout_in(context),
    is_on_this_machine: context.environment?.env_kind !== 'remote_sandbox',
  };
}

function layout_gives_the_path_another_job(workspace_path: string, layout: WorkspaceLayout) {
  const segments = workspace_path.split('/');
  return (
    is_memory_root_path(workspace_path) ||
    !workspace_path_is_durable(workspace_path) ||
    segments.some((segment) => segment.startsWith('.')) ||
    layout.folders.some((folder) => workspace_path.startsWith(`${folder.path}/`)) ||
    [...layout.memory_files, ...pages_the_platform_keeps_at_the_root].includes(workspace_path)
  );
}

/** The metadata a write tool puts on its result so the written file gets a file record. */
export function produced_file_metadata(
  workspace_path: string,
  workspace: WrittenWorkspace,
): Record<string, unknown> {
  const file_purpose = produced_file_kind(workspace_path, workspace);
  return {
    workspace_path,
    ...(file_purpose === undefined
      ? {}
      : {
          produced_workspace_path: workspace_path,
          produced_artifact_kind: file_purpose,
        }),
  };
}
