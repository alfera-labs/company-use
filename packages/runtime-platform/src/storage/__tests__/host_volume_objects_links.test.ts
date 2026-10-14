import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  an_open_file_knows_its_path,
  swap_folder_with_link,
} from '@agent-core/__tests__/swap_folder_with_link';
import { content_version_for_bytes } from '@runtime-platform/files/workspace_file_content';
import {
  list_host_workspace_entries,
  read_host_workspace_bytes,
  replace_host_workspace_bytes,
  write_host_workspace_bytes,
} from '@runtime-platform/storage/host_volume_objects';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let base: string;
let host_workspace_root: string;
let outside: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'coworker-host-links-')));
  host_workspace_root = path.join(base, 'workspace');
  outside = path.join(base, 'outside');
  await mkdir(host_workspace_root);
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'outside secret', 'utf8');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);
const text_of = (data: Uint8Array) => Buffer.from(data).toString('utf8');
const file = (workspace_path: string) => ({ host_workspace_root, workspace_path });
const refused = { code: 'workspace_path_invalid', status: 400 };

describe('a dashboard write the sandbox tries to send out of the workspace', () => {
  it('refuses a name that is a dangling link to a file outside, and does not create that file', async () => {
    await symlink(path.join(outside, 'planted.txt'), path.join(host_workspace_root, 'note.txt'));

    await expect(
      write_host_workspace_bytes({ ...file('note.txt'), data: bytes('planted') }),
    ).rejects.toMatchObject(refused);

    expect(await readdir(outside)).toEqual(['secret.txt']);
  });

  it('refuses a new file under a folder that is a link to outside, and creates nothing there', async () => {
    await symlink(outside, path.join(host_workspace_root, 'door'));

    await expect(
      write_host_workspace_bytes({ ...file('door/new/deep/note.txt'), data: bytes('planted') }),
    ).rejects.toMatchObject(refused);
    await expect(
      write_host_workspace_bytes({ ...file('door/note.txt'), data: bytes('planted') }),
    ).rejects.toMatchObject(refused);
    await expect(
      replace_host_workspace_bytes({
        ...file('door/secret.txt'),
        data: bytes('planted'),
        expected_version: content_version_for_bytes(bytes('outside secret')),
      }),
    ).rejects.toMatchObject(refused);

    expect(await readdir(outside)).toEqual(['secret.txt']);
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('outside secret');
  });
});

describe('a dashboard read the sandbox tries to send out of the workspace', () => {
  it('refuses a name that is a link to a file outside', async () => {
    await symlink(path.join(outside, 'secret.txt'), path.join(host_workspace_root, 'note.txt'));

    await expect(read_host_workspace_bytes(file('note.txt'))).rejects.toMatchObject(refused);
  });

  it('refuses a file or a listing under a folder that is a link to outside', async () => {
    await symlink(outside, path.join(host_workspace_root, 'door'));

    await expect(read_host_workspace_bytes(file('door/secret.txt'))).rejects.toMatchObject(refused);
    await expect(list_host_workspace_entries(file('door'))).rejects.toMatchObject(refused);
  });

  it('refuses a file that was a plain file a moment ago and is a link to outside now', async () => {
    await writeFile(path.join(host_workspace_root, 'note.txt'), 'inside', 'utf8');
    expect(text_of(await read_host_workspace_bytes(file('note.txt')))).toBe('inside');

    await rm(path.join(host_workspace_root, 'note.txt'));
    await symlink(path.join(outside, 'secret.txt'), path.join(host_workspace_root, 'note.txt'));

    await expect(read_host_workspace_bytes(file('note.txt'))).rejects.toMatchObject(refused);
  });

  it.skipIf(!an_open_file_knows_its_path)(
    'never returns the outside file while another process swaps the folder and a link',
    async () => {
      await mkdir(path.join(host_workspace_root, 'swap'));
      await writeFile(path.join(host_workspace_root, 'swap/secret.txt'), 'inside', 'utf8');
      const swapping = swap_folder_with_link({
        folder: path.join(host_workspace_root, 'swap'),
        link_target: outside,
        run_ms: 1_000,
      });

      const seen = new Map<string, number>();
      while (swapping.is_running()) {
        const text = await read_host_workspace_bytes(file('swap/secret.txt')).then(
          text_of,
          () => 'no read',
        );
        seen.set(text, (seen.get(text) ?? 0) + 1);
      }

      expect(await swapping.swap_count).toBeGreaterThan(0);
      expect(seen.get('inside')).toBeGreaterThan(0);
      expect(seen.get('outside secret') ?? 0).toBe(0);
    },
    15_000,
  );
});

describe('honest dashboard reads and writes in the workspace', () => {
  it('reads, writes, overwrites, and creates a file in new nested folders', async () => {
    await write_host_workspace_bytes({ ...file('note.txt'), data: bytes('first, and long') });
    await write_host_workspace_bytes({ ...file('note.txt'), data: bytes('second') });
    await write_host_workspace_bytes({ ...file('a/b/c/note.txt'), data: bytes('nested') });

    expect(text_of(await read_host_workspace_bytes(file('note.txt')))).toBe('second');
    expect(text_of(await read_host_workspace_bytes(file('a/b/c/note.txt')))).toBe('nested');
    expect(await readdir(path.join(host_workspace_root, 'a/b/c'))).toEqual(['note.txt']);
  });

  it('replaces a file only at the version the person opened, and keeps its permissions', async () => {
    await writeFile(path.join(host_workspace_root, 'run.sh'), 'echo one', 'utf8');
    await chmod(path.join(host_workspace_root, 'run.sh'), 0o755);

    await expect(
      replace_host_workspace_bytes({
        ...file('run.sh'),
        data: bytes('echo three'),
        expected_version: content_version_for_bytes(bytes('echo stale')),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await replace_host_workspace_bytes({
      ...file('run.sh'),
      data: bytes('echo two'),
      expected_version: content_version_for_bytes(bytes('echo one')),
    });

    expect(await readFile(path.join(host_workspace_root, 'run.sh'), 'utf8')).toBe('echo two');
    expect((await stat(path.join(host_workspace_root, 'run.sh'))).mode & 0o777).toBe(0o755);
    expect(await readdir(host_workspace_root)).toEqual(['run.sh']);
  });

  it('reads through a link that stays inside the workspace', async () => {
    await mkdir(path.join(host_workspace_root, 'real'));
    await writeFile(path.join(host_workspace_root, 'real/note.txt'), 'inside', 'utf8');
    await symlink(
      path.join(host_workspace_root, 'real/note.txt'),
      path.join(host_workspace_root, 'note_link.txt'),
    );
    await symlink(
      path.join(host_workspace_root, 'real'),
      path.join(host_workspace_root, 'folder_link'),
    );

    expect(text_of(await read_host_workspace_bytes(file('note_link.txt')))).toBe('inside');
    expect(text_of(await read_host_workspace_bytes(file('folder_link/note.txt')))).toBe('inside');
    expect((await list_host_workspace_entries(file('folder_link'))).files).toMatchObject([
      { file_name: 'note.txt', byte_size: 6 },
    ]);
    await write_host_workspace_bytes({ ...file('folder_link/new.txt'), data: bytes('new') });
    expect(await readFile(path.join(host_workspace_root, 'real/new.txt'), 'utf8')).toBe('new');
  });
});
