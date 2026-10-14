import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  open_file_inside_roots,
  PathLeavesRootsError,
  read_file_inside_roots,
  replace_file_inside_roots,
  with_folder_inside_roots,
} from '@agent-core/environment/open_inside_roots';
import { is_path_inside } from '@agent-core/environment/workspace_path_escape';
import { AppError } from '@coworker/shared';
import { content_version_for_bytes } from '@runtime-platform/files/workspace_file_content';
import { workspace_file_version_conflict } from '@runtime-platform/storage/atomic_volume_replace';
import { is_no_file_error } from '@runtime-platform/storage/host_volume';
import {
  is_browsable_file_name,
  is_browsable_folder_name,
  type ListedVolumeEntry,
} from '@runtime-platform/storage/volume_objects';

export type HostWorkspaceFile = { host_workspace_root: string; workspace_path: string };

export async function read_host_workspace_bytes(file: HostWorkspaceFile): Promise<Uint8Array> {
  return new Uint8Array(await inside_host_workspace(file, read_file_inside_roots));
}

/** One folder of the workspace on this machine's disk: its files and its immediate subfolders. */
export function list_host_workspace_entries(
  folder: HostWorkspaceFile,
): Promise<{ folder_names: string[]; files: ListedVolumeEntry[] }> {
  return inside_host_workspace(folder, (roots, absolute_path) =>
    with_folder_inside_roots(roots, absolute_path, list_folder_entries),
  );
}

async function list_folder_entries(folder_path: string) {
  const entries = await fs.readdir(folder_path, { withFileTypes: true });
  const file_names = entries
    .filter((entry) => entry.isFile() && is_browsable_file_name(entry.name))
    .map((entry) => entry.name);
  return {
    folder_names: entries
      .filter((entry) => entry.isDirectory() && is_browsable_folder_name(entry.name))
      .map((entry) => entry.name)
      .sort(),
    files: await Promise.all(
      file_names.sort().map((file_name) => describe_host_file(folder_path, file_name)),
    ),
  };
}

const most_subfolders_read_per_folder = 20;

/**
 * The subfolders of one workspace folder that hold no file at any depth, such as the starter
 * folders of a new workspace. A link counts as a file and is never followed.
 *
 * A folder with more than 20 subfolders and no file of its own is reported as not
 * empty without a look inside, so one listing never reads a wide tree. Read deeper if a real
 * workspace keeps a wide tree of empty folders.
 */
export function list_empty_host_folder_names(folder: HostWorkspaceFile): Promise<string[]> {
  return inside_host_workspace(folder, (roots, absolute_path) =>
    with_folder_inside_roots(roots, absolute_path, list_empty_folder_names),
  );
}

async function list_empty_folder_names(folder_path: string) {
  const entries = await fs.readdir(folder_path, { withFileTypes: true });
  const folder_names = entries
    .filter((entry) => entry.isDirectory() && is_browsable_folder_name(entry.name))
    .map((entry) => entry.name);
  const holds_no_file = await Promise.all(
    folder_names.map((folder_name) => folder_holds_no_file(path.join(folder_path, folder_name))),
  );
  return folder_names.filter((_, index) => holds_no_file[index]).sort();
}

async function folder_holds_no_file(folder_path: string): Promise<boolean> {
  const entries = await read_folder_if_allowed(folder_path);
  if (!entries || entries.length > most_subfolders_read_per_folder) return false;
  if (entries.some((entry) => !entry.isDirectory())) return false;
  const nested = await Promise.all(
    entries.map((entry) => folder_holds_no_file(path.join(folder_path, entry.name))),
  );
  return nested.every(Boolean);
}

async function read_folder_if_allowed(folder_path: string) {
  try {
    return await fs.readdir(folder_path, { withFileTypes: true });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'EACCES' || code === 'EPERM' || is_no_file_error(error)) return null;
    throw error;
  }
}

export async function write_host_workspace_bytes(file: HostWorkspaceFile & { data: Uint8Array }) {
  await write_file_in_one_step(file);
}

/**
 * Replaces a file only while it is still the version the person opened.
 *
 * The version check and the rename are two steps with no lock between them, so two
 * saves landing in the same instant can both pass and the later rename wins. Take a per-file
 * lock here if people start editing one file at the same time.
 */
export async function replace_host_workspace_bytes(
  file: HostWorkspaceFile & { data: Uint8Array; expected_version: string },
) {
  const current = await inside_host_workspace(file, read_file_that_is_not_a_link);
  const actual_version = content_version_for_bytes(current.bytes);
  if (actual_version !== file.expected_version) {
    throw workspace_file_version_conflict(actual_version);
  }
  await write_file_in_one_step(file, current.mode);
}

async function describe_host_file(folder_path: string, file_name: string) {
  const metadata = await fs.lstat(path.join(folder_path, file_name));
  return {
    file_name,
    byte_size: metadata.size,
    last_modified_time: metadata.mtime.toISOString(),
  };
}

function write_file_in_one_step(file: HostWorkspaceFile & { data: Uint8Array }, mode?: number) {
  return inside_host_workspace(file, async (roots, absolute_path) => {
    await refuse_to_edit_a_link(absolute_path);
    await replace_file_inside_roots(
      roots,
      absolute_path,
      (new_file) => new_file.writeFile(file.data),
      mode,
    );
  });
}

async function read_file_that_is_not_a_link(roots: readonly string[], absolute_path: string) {
  await refuse_to_edit_a_link(absolute_path);
  const opened = await open_file_inside_roots(roots, absolute_path);
  try {
    return { bytes: await opened.readFile(), mode: (await opened.stat()).mode };
  } finally {
    await opened.close();
  }
}

async function inside_host_workspace<T>(
  file: HostWorkspaceFile,
  use: (roots: readonly string[], absolute_path: string) => Promise<T>,
) {
  const root = await fs.realpath(file.host_workspace_root);
  const absolute_path = lexical_host_path(root, file.workspace_path);
  try {
    return await use([root], absolute_path);
  } catch (error) {
    if (error instanceof PathLeavesRootsError) throw outside_workspace();
    throw error;
  }
}

function lexical_host_path(root: string, workspace_path: string) {
  const resolved = path.resolve(root, workspace_path);
  if (
    workspace_path.includes('\0') ||
    path.isAbsolute(workspace_path) ||
    !is_path_inside(root, resolved)
  ) {
    throw outside_workspace();
  }
  return resolved;
}

async function refuse_to_edit_a_link(absolute_path: string) {
  const found = await fs.lstat(absolute_path).catch((error) => {
    if (is_no_file_error(error)) return null;
    throw error;
  });
  if (found?.isSymbolicLink()) throw outside_workspace('Workspace file symlinks cannot be edited.');
}

function outside_workspace(message = 'The requested path is not inside the workspace.') {
  return new AppError('workspace_path_invalid', message, 400);
}
