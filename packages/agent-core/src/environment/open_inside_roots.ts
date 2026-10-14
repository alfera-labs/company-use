import { randomUUID } from 'node:crypto';
import { type BigIntStats, constants, existsSync, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { is_path_inside } from '@agent-core/environment/workspace_path_escape';

const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_DIRECTORY, O_NONBLOCK } = constants;
const read_file_flags = O_RDONLY | O_NONBLOCK;
const read_folder_flags = O_RDONLY | O_DIRECTORY;
const new_file_flags = O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW;
const existing_file_flags = O_WRONLY | O_NONBLOCK;

const linux_open_handles_folder = '/proc/self/fd';
const linux_names_open_handles = existsSync(linux_open_handles_folder);
const macos_files_by_identity_folder = '/.vol';
const no_lookup_by_identity_codes = ['ENOENT', 'ENOTSUP'];

type Roots = readonly string[];
type Located = { real_path: string; address: string };
type Opened = { handle: FileHandle; address: string };

/** A path that is not inside any of the roots it was opened under, once every link is followed. */
export class PathLeavesRootsError extends Error {
  constructor() {
    super('Path leaves its roots.');
  }
}

/**
 * Opens an existing file to read. The check is on the open file, not on its name: the file is
 * opened first, then refused unless what was opened is inside one of the real `roots`. A link
 * that stays inside the roots is followed. The caller reads through the handle and closes it.
 */
export async function open_file_inside_roots(roots: Roots, absolute_path: string) {
  return (await open_inside_roots(roots, absolute_path, read_file_flags)).handle;
}

export async function read_file_inside_roots(roots: Roots, absolute_path: string) {
  const file = await open_file_inside_roots(roots, absolute_path);
  return close_after(file, () => file.readFile());
}

/**
 * Writes a file in place, and creates it and its folders when they are missing. Each folder is
 * created and opened one level at a time under a root, and the file is opened inside the last
 * open folder, so no link on the way can send the write out of the roots. A dangling link is
 * refused.
 */
export async function write_file_inside_roots(
  roots: Roots,
  absolute_path: string,
  contents: string | Uint8Array,
) {
  const folder = await open_folder_to_fill(roots, path.dirname(absolute_path));
  const file = await close_after(folder.handle, () =>
    open_file_to_overwrite(roots, path.join(folder.address, path.basename(absolute_path))),
  );
  await close_after(file, async () => {
    await file.truncate(0);
    await file.writeFile(contents);
  });
}

/**
 * Replaces a file in one step: `write_contents` fills a new file beside it in the checked
 * folder, and a rename puts it in place. A link at that name is replaced, never followed.
 */
export async function replace_file_inside_roots(
  roots: Roots,
  absolute_path: string,
  write_contents: (new_file: FileHandle) => Promise<unknown>,
  mode?: number,
) {
  const folder = await open_folder_to_fill(roots, path.dirname(absolute_path));
  const file_path = path.join(folder.address, path.basename(absolute_path));
  const new_file_path = `${file_path}.alfera-${randomUUID()}`;
  await close_after(folder.handle, async () => {
    try {
      const new_file = await open_inside_roots(roots, new_file_path, new_file_flags, mode);
      await close_after(new_file.handle, () => write_contents(new_file.handle));
      await fs.rename(new_file_path, file_path);
    } finally {
      await fs.rm(new_file_path, { force: true });
    }
  });
}

/** Creates a folder and its missing parents, one level at a time, each checked once it is open. */
export async function create_folder_inside_roots(roots: Roots, absolute_folder: string) {
  await (await open_folder_to_fill(roots, absolute_folder)).handle.close();
}

/**
 * Opens an existing folder, checks it like a file, and runs `use` with a path that names the
 * open folder until `use` is done.
 */
export async function with_folder_inside_roots<T>(
  roots: Roots,
  absolute_path: string,
  use: (folder_path: string) => Promise<T>,
) {
  const folder = await open_inside_roots(roots, absolute_path, read_folder_flags);
  return close_after(folder.handle, () => use(folder.address));
}

async function open_inside_roots(roots: Roots, named_path: string, flags: number, mode?: number) {
  const handle = await fs.open(named_path, flags, mode);
  try {
    const { real_path, address } = await locate_open_handle(handle, named_path);
    if (!roots.some((root) => is_path_inside(root, real_path))) {
      throw new PathLeavesRootsError();
    }
    return { handle, address };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function locate_open_handle(handle: FileHandle, named_path: string): Promise<Located> {
  if (linux_names_open_handles) {
    const address = `${linux_open_handles_folder}/${handle.fd}`;
    return { address, real_path: await fs.readlink(address) };
  }
  const identity = await handle.stat({ bigint: true });
  const address = `${macos_files_by_identity_folder}/${identity.dev}/${identity.ino}`;
  const real_path = await fs.realpath(address).catch((error) => {
    if (!no_lookup_by_identity_codes.some((code) => has_error_code(error, code))) throw error;
  });
  return real_path ? { address, real_path } : locate_open_handle_by_name(named_path, identity);
}

// Where the system cannot say where an open file is (no /proc/self/fd and no lookup by
// identity: macOS under Node, a volume without that lookup, other systems), the name is resolved
// again and must still be the open file, by device and inode. This does not close a folder
// swapped for a link, back, and to the link again in step with these calls, nor an empty file or
// folder made under a folder swapped right after its check. Ask the handle itself (fcntl
// F_GETPATH) if such a host ever runs a sandbox it does not trust.
async function locate_open_handle_by_name(named_path: string, identity: BigIntStats) {
  const real_path = await fs.realpath(named_path);
  const named = await fs.lstat(real_path, { bigint: true });
  if (identity.dev !== named.dev || identity.ino !== named.ino) {
    throw new PathLeavesRootsError();
  }
  return { address: real_path, real_path };
}

function open_folder_to_fill(roots: Roots, absolute_folder: string): Promise<Opened> {
  const folder_path = path.resolve(absolute_folder);
  const root = roots.find((candidate) => is_path_inside(candidate, folder_path));
  if (!root) throw new PathLeavesRootsError();
  const names_below_root = path.relative(root, folder_path).split(path.sep).filter(Boolean);
  return names_below_root.reduce(
    (parent, name) =>
      parent.then((folder) =>
        close_after(folder.handle, () =>
          open_new_or_existing_folder(roots, path.join(folder.address, name)),
        ),
      ),
    open_new_or_existing_folder(roots, root),
  );
}

async function open_new_or_existing_folder(roots: Roots, named_path: string) {
  await fs.mkdir(named_path).catch((error) => {
    if (!has_error_code(error, 'EEXIST')) throw error;
  });
  return open_inside_roots(roots, named_path, read_folder_flags);
}

async function open_file_to_overwrite(roots: Roots, named_path: string) {
  try {
    return (await open_inside_roots(roots, named_path, new_file_flags)).handle;
  } catch (error) {
    if (!has_error_code(error, 'EEXIST')) throw error;
  }
  try {
    return (await open_inside_roots(roots, named_path, existing_file_flags)).handle;
  } catch (error) {
    throw has_error_code(error, 'ENOENT') ? new PathLeavesRootsError() : error;
  }
}

function has_error_code(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function close_after<T>(handle: FileHandle, use: () => Promise<T>) {
  try {
    return await use();
  } finally {
    await handle.close();
  }
}
