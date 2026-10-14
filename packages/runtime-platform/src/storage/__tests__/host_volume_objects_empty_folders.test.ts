import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  list_empty_host_folder_names,
  list_host_workspace_entries,
} from '@runtime-platform/storage/host_volume_objects';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let host_workspace_root: string;

beforeEach(async () => {
  host_workspace_root = await mkdtemp(path.join(tmpdir(), 'coworker-empty-folders-'));
});

afterEach(async () => {
  await rm(host_workspace_root, { recursive: true, force: true });
});

async function make_folder(...segments: string[]) {
  await mkdir(path.join(host_workspace_root, ...segments), { recursive: true });
}

async function make_file(...segments: string[]) {
  await make_folder(...segments.slice(0, -1));
  await writeFile(path.join(host_workspace_root, ...segments), 'x');
}

describe('the empty folders of a workspace kept on this machine', () => {
  it('names the starter folders that hold no file, at any depth', async () => {
    await make_folder('people');
    await make_folder('system', 'activity');
    await make_folder('system', 'browser');
    await make_file('outputs', 'chart.png');
    await make_file('skills', 'weekly-cash-note', 'SKILL.md');
    await make_file('.venv', 'pyvenv.cfg');
    await make_folder('tmp');
    await make_file('notes.md');

    const empty = await list_empty_host_folder_names({ host_workspace_root, workspace_path: '' });

    expect(empty).toEqual(['people', 'system', 'tmp']);
  });

  it('keeps the plain listing as it was, hidden names included', async () => {
    await make_file('.venv', 'pyvenv.cfg');
    await make_folder('tmp');
    await make_file('notes.md');

    const listed = await list_host_workspace_entries({ host_workspace_root, workspace_path: '' });

    expect(listed.folder_names).toEqual(['.venv', 'tmp']);
    expect(listed.files.map((file) => file.file_name)).toEqual(['notes.md']);
  });

  it('counts a link as content and does not follow it out of the workspace', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'coworker-outside-'));
    try {
      await make_folder('linked');
      await symlink(outside, path.join(host_workspace_root, 'linked', 'door'));

      const empty = await list_empty_host_folder_names({ host_workspace_root, workspace_path: '' });

      expect(empty).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'lists a folder it may not read as a folder with content',
    async () => {
      await make_folder('locked');
      const locked = path.join(host_workspace_root, 'locked');
      await chmod(locked, 0o000);
      try {
        const empty = await list_empty_host_folder_names({
          host_workspace_root,
          workspace_path: '',
        });

        expect(empty).toEqual([]);
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );

  it('does not read inside a folder that has more than 20 subfolders', async () => {
    await Promise.all(
      Array.from({ length: 21 }, (_, index) => make_folder('wide', `part-${index}`)),
    );
    await make_folder('narrow', 'part');

    const empty = await list_empty_host_folder_names({ host_workspace_root, workspace_path: '' });

    expect(empty).toEqual(['narrow']);
  });
});
