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
import { create_local_session_env } from '@agent-core/environment';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let base: string;
let workspace: string;
let outside: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-core-links-')));
  workspace = path.join(base, 'workspace');
  outside = path.join(base, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'outside secret', 'utf8');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const open_env = () => create_local_session_env({ working_directory: workspace });
const text_stream = (text: string) => new Blob([text]).stream();
const refused = /(Path|Symlink) escapes workspace/;

describe('a write the sandbox tries to send out of the workspace', () => {
  it('refuses a name that is a dangling link to a file outside, and does not create that file', async () => {
    await symlink(path.join(outside, 'planted.txt'), path.join(workspace, 'note.txt'));

    await expect(open_env().write?.('note.txt', 'planted')).rejects.toThrow(refused);
    await expect(
      open_env().write_bytes?.('note.txt', text_stream('planted')),
    ).resolves.toBeUndefined();

    expect(await readdir(outside)).toEqual(['secret.txt']);
    expect(await readFile(path.join(workspace, 'note.txt'), 'utf8')).toBe('planted');
  });

  it('refuses a name that is a link to an existing file outside, and leaves that file alone', async () => {
    await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'note.txt'));

    await expect(open_env().write?.('note.txt', 'planted')).rejects.toThrow(refused);

    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('outside secret');
  });

  it('refuses a new file under a folder that is a link to outside, and creates nothing there', async () => {
    await symlink(outside, path.join(workspace, 'door'));

    await expect(open_env().write?.('door/new/deep/note.txt', 'planted')).rejects.toThrow(refused);
    await expect(
      open_env().write_bytes?.('door/other/deep/note.bin', text_stream('planted')),
    ).rejects.toThrow(refused);
    await expect(open_env().write?.('door/note.txt', 'planted')).rejects.toThrow(refused);

    expect(await readdir(outside)).toEqual(['secret.txt']);
  });
});

describe('a read the sandbox tries to send out of the workspace', () => {
  it('refuses a name that is a link to a file outside', async () => {
    await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'note.txt'));

    await expect(open_env().read?.('note.txt')).rejects.toThrow(refused);
    await expect(open_env().read_bytes?.('note.txt')).rejects.toThrow(refused);
  });

  it('refuses a file under a folder that is a link to outside', async () => {
    await symlink(outside, path.join(workspace, 'door'));

    await expect(open_env().read?.('door/secret.txt')).rejects.toThrow(refused);
    await expect(open_env().read_bytes?.('door/secret.txt')).rejects.toThrow(refused);
    await expect(open_env().list?.({ path: 'door' })).rejects.toThrow(refused);
  });

  it('refuses a file that was a plain file a moment ago and is a link to outside now', async () => {
    const env = open_env();
    await env.write?.('note.txt', 'inside');
    expect(await env.stat?.('note.txt')).toEqual({ kind: 'file', byte_size: 6 });

    await rm(path.join(workspace, 'note.txt'));
    await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'note.txt'));

    await expect(env.read?.('note.txt')).rejects.toThrow(refused);
    await expect(env.read_bytes?.('note.txt')).rejects.toThrow(refused);
  });

  it.skipIf(!an_open_file_knows_its_path)(
    'never returns the outside file while another process swaps the folder and a link',
    async () => {
      const env = open_env();
      await mkdir(path.join(workspace, 'swap'));
      await writeFile(path.join(workspace, 'swap/secret.txt'), 'inside', 'utf8');
      const swapping = swap_folder_with_link({
        folder: path.join(workspace, 'swap'),
        link_target: outside,
        run_ms: 1_000,
      });

      const seen = new Map<string, number>();
      while (swapping.is_running()) {
        const text = await env.read_bytes?.('swap/secret.txt').then(
          (bytes) => Buffer.from(bytes).toString('utf8'),
          () => 'no read',
        );
        seen.set(String(text), (seen.get(String(text)) ?? 0) + 1);
      }

      expect(await swapping.swap_count).toBeGreaterThan(0);
      expect(seen.get('inside')).toBeGreaterThan(0);
      expect(seen.get('outside secret') ?? 0).toBe(0);
    },
    15_000,
  );
});

describe('honest reads and writes in the workspace', () => {
  it('reads, writes, overwrites, and creates a file in new nested folders', async () => {
    const env = open_env();

    await env.write?.('note.txt', 'first, and long');
    await env.write?.('note.txt', 'second');
    await env.write?.('a/b/c/note.txt', 'nested');
    await env.write_bytes?.('x/y/data.bin', text_stream('bytes'));
    await env.write_bytes?.('x/y/data.bin', text_stream('new bytes'));

    expect(await env.read?.('note.txt')).toBe('second');
    expect(await env.read?.('a/b/c/note.txt')).toBe('nested');
    expect(Buffer.from((await env.read_bytes?.('x/y/data.bin')) ?? []).toString()).toBe(
      'new bytes',
    );
    expect((await readdir(path.join(workspace, 'x/y'))).sort()).toEqual(['data.bin']);
  });

  it('keeps the permissions of a file it overwrites', async () => {
    const env = open_env();
    await env.write?.('run.sh', 'echo one');
    await chmod(path.join(workspace, 'run.sh'), 0o755);

    await env.write?.('run.sh', 'echo two');

    expect((await stat(path.join(workspace, 'run.sh'))).mode & 0o777).toBe(0o755);
  });

  it('reads and writes through a link that stays inside the workspace', async () => {
    const env = open_env();
    await env.write?.('real/note.txt', 'inside');
    await symlink(path.join(workspace, 'real/note.txt'), path.join(workspace, 'note_link.txt'));
    await symlink(path.join(workspace, 'real'), path.join(workspace, 'folder_link'));

    expect(await env.read?.('note_link.txt')).toBe('inside');
    expect(await env.read?.('folder_link/note.txt')).toBe('inside');
    expect((await env.list?.({ path: 'folder_link' }))?.map((entry) => entry.name)).toEqual([
      'note.txt',
    ]);

    await env.write?.('note_link.txt', 'through the link');
    await env.write?.('folder_link/new/other.txt', 'under the link');

    expect(await readFile(path.join(workspace, 'real/note.txt'), 'utf8')).toBe('through the link');
    expect(await readFile(path.join(workspace, 'real/new/other.txt'), 'utf8')).toBe(
      'under the link',
    );
  });
});
