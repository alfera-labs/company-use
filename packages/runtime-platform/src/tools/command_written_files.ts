import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SessionEnv } from '@agent-core/environment';
import type { Database } from '@coworker/core';
import { create_file, list_run_files } from '@coworker/core/db/queries/files';
import { map_with_concurrency } from '@coworker/shared';
import { mime_type_for_file_name } from '@runtime-platform/files/file_mime_types';
import { workspace_layout_for_version } from '@runtime-platform/storage/workspace_layouts';
import { produced_file_kind } from '@runtime-platform/tools/produced_workspace_files';

const folders_that_tools_fill = new Set(['node_modules', '__pycache__']);
const most_paths_checked = 5_000;
const most_files_recorded = 20;
const clock_tick_ms = 1_000;

type WrittenFile = {
  workspace_path: string;
  file_purpose: string;
  byte_size: number;
  written_at_ms: number;
};

type CommandRun = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  runtime_environment_id?: string;
  source_tool_call_id: string;
  actor_id: string;
  environment: SessionEnv | undefined;
  command_started_at_ms: number;
};

/**
 * Gives a file record to each file a command wrote, copied or moved into place, by the same
 * rule as a file the write tool wrote: at most the 20 newest files of one command, and none
 * from a hidden folder or a folder that tools fill. It reads the workspace folder itself, so it
 * works where the sandbox keeps the workspace in a folder on this machine. A remote sandbox
 * gets no records from here.
 */
export async function record_files_a_command_wrote(db: Database, command: CommandRun) {
  const workspace_folder = local_workspace_folder(command.environment);
  if (!workspace_folder) return [];
  const written = await list_files_written_since(workspace_folder, command);
  const known = await list_run_files(db, command.workspace_id, command.run_id);
  const is_known = (file: WrittenFile) =>
    known.some(
      (record) =>
        record.workspace_path === file.workspace_path && record.byte_size === file.byte_size,
    );
  return Promise.all(
    written
      .filter((file) => !is_known(file))
      .map((file) => create_written_file_record(db, command, file)),
  );
}

function local_workspace_folder(environment: SessionEnv | undefined) {
  const folder = environment?.metadata?.workspace_root;
  return environment?.env_kind !== 'remote_sandbox' && typeof folder === 'string' ? folder : null;
}

// One listing of the whole folder per command, and a stat of at most 5,000 paths that
// count. A workspace with more produced files than that misses some; walk only changed folders
// (a watcher) if a self-host ever gets that large.
async function list_files_written_since(workspace_folder: string, command: CommandRun) {
  const layout = {
    layout: workspace_layout_for_version(command.environment?.metadata?.workspace_layout_version),
    is_on_this_machine: true,
  };
  const paths = (await readdir(workspace_folder, { recursive: true }))
    .map((found) => found.split(path.sep).join('/'))
    .filter((workspace_path) => !is_inside_a_folder_that_tools_fill(workspace_path))
    .filter((workspace_path) => produced_file_kind(workspace_path, layout) !== undefined)
    .slice(0, most_paths_checked);
  const checked = await map_with_concurrency(paths, 32, (workspace_path) =>
    read_written_file(workspace_folder, workspace_path, {
      file_purpose: produced_file_kind(workspace_path, layout),
      written_since_ms: command.command_started_at_ms - clock_tick_ms,
    }),
  );
  return checked
    .flat()
    .sort((left, right) => right.written_at_ms - left.written_at_ms)
    .slice(0, most_files_recorded);
}

function is_inside_a_folder_that_tools_fill(workspace_path: string) {
  return workspace_path
    .split('/')
    .some((segment) => segment.startsWith('.') || folders_that_tools_fill.has(segment));
}

async function read_written_file(
  workspace_folder: string,
  workspace_path: string,
  rule: { file_purpose: string | undefined; written_since_ms: number },
): Promise<WrittenFile[]> {
  const found = await stat(path.join(workspace_folder, workspace_path)).catch(
    null_when_the_file_is_gone,
  );
  if (!found?.isFile() || !rule.file_purpose) return [];
  const written_at_ms = Math.max(found.mtimeMs, found.ctimeMs);
  if (written_at_ms < rule.written_since_ms) return [];
  return [
    { workspace_path, file_purpose: rule.file_purpose, byte_size: found.size, written_at_ms },
  ];
}

function null_when_the_file_is_gone(error: unknown) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
  throw error;
}

function create_written_file_record(db: Database, command: CommandRun, file: WrittenFile) {
  const file_name = path.posix.basename(file.workspace_path);
  return create_file(db, {
    workspace_id: command.workspace_id,
    session_id: command.session_id,
    run_id: command.run_id,
    runtime_environment_id: command.runtime_environment_id ?? null,
    source_tool_call_id: command.source_tool_call_id,
    file_purpose: file.file_purpose,
    storage_provider: 'local_workspace',
    storage_key: file.workspace_path,
    workspace_path: file.workspace_path,
    file_name,
    mime_type: mime_type_for_file_name(file_name),
    byte_size: file.byte_size,
    file_metadata: { source: 'workspace_command' },
    actor_id: command.actor_id,
  });
}
