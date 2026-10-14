import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { locate_coding_workspace } from '@runtime-platform/orchestrator/workspace_location';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let base: string;
let outside: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'coworker-location-links-')));
  outside = path.join(base, 'outside');
  await mkdir(outside);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const open_shared_workspace = (run_id: string) =>
  locate_coding_workspace(
    {
      workspace_id: 'ws_1',
      session_id: 'ses_1',
      agent_id: 'agt_1',
      run_id,
      workspace_base_path: path.join(base, 'workspaces'),
    },
    'docker',
    undefined,
  );

describe('the folders a docker run gets in the shared workspace', () => {
  it('makes the layout folders and the run scratch folder, on the first run and on the next', async () => {
    const first = await open_shared_workspace('run_1');
    const second = await open_shared_workspace('run_2');

    expect(second).toEqual(first);
    expect(await readdir(path.join(first.host_workspace_root, 'system'))).toEqual(
      expect.arrayContaining(['activity', 'browser', 'tool-output']),
    );
    expect((await readdir(first.host_scratch_root ?? '')).sort()).toEqual([
      'home',
      'run_1',
      'run_2',
    ]);
  });

  it('refuses a layout folder the sandbox replaced with a link to outside, and makes nothing there', async () => {
    const { host_workspace_root } = await open_shared_workspace('run_1');
    await rm(path.join(host_workspace_root, 'system'), { recursive: true });
    await symlink(outside, path.join(host_workspace_root, 'system'));

    await expect(open_shared_workspace('run_2')).rejects.toThrow(/leaves the workspace/);

    expect(await readdir(outside)).toEqual([]);
  });
});
