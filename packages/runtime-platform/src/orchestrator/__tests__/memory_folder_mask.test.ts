import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env } from '@agent-core/environment';
import {
  company_memory_mask_targets,
  mask_company_memory_folders,
  memory_folder_mask_script,
  memory_folder_unmask_script,
} from '@runtime-platform/orchestrator/memory_folder_mask';
import { workspace_layout_for_version } from '@runtime-platform/storage/workspace_layouts';
import { afterEach, describe, expect, it } from 'vitest';

const layout_v2 = workspace_layout_for_version(2);
const created_directories: string[] = [];

afterEach(() => {
  for (const directory of created_directories.splice(0)) rmSync(directory, { recursive: true });
});

const recorded_stubs = {
  mount: [
    'echo "mount $*" >> "$MASK_LOG"',
    'case " $* " in *" --make-private "*|*"remount"*) exit 0 ;; esac',
    'for target; do :; done',
    'echo "$target" >> "$MASK_STATE"',
  ],
  umount: [
    'echo "umount $*" >> "$MASK_LOG"',
    'for target; do :; done',
    'grep -vxF -- "$target" "$MASK_STATE" > "$MASK_STATE.next" || true',
    'mv "$MASK_STATE.next" "$MASK_STATE"',
  ],
  findmnt: ['for target; do :; done', 'grep -qxF -- "$target" "$MASK_STATE"'],
};

function create_fake_sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'zq-test-memory-mask-'));
  created_directories.push(root);
  const bin = path.join(root, 'bin');
  const workspace = path.join(root, 'workspace');
  mkdirSync(bin);
  for (const folder of ['people', 'companies', 'daily-logs']) {
    mkdirSync(path.join(workspace, folder), { recursive: true });
  }
  writeFileSync(path.join(workspace, 'user.md'), 'private profile\n');
  for (const [name, lines] of Object.entries(recorded_stubs)) {
    writeFileSync(path.join(bin, name), ['#!/usr/bin/env bash', ...lines].join('\n'));
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(path.join(root, 'state'), '');
  writeFileSync(path.join(root, 'log'), '');
  return { root, bin, workspace, source: path.join(root, 'mask-source') };
}

function run_script(sandbox: ReturnType<typeof create_fake_sandbox>, script: string) {
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: `${sandbox.bin}:/usr/bin:/bin`,
      MASK_STATE: path.join(sandbox.root, 'state'),
      MASK_LOG: path.join(sandbox.root, 'log'),
    },
  });
  return { exit_code: result.status, stderr: result.stderr };
}

const read_lines = (file_path: string) =>
  readFileSync(file_path, 'utf8').split('\n').filter(Boolean);

function roots_in(workspace: string, volume: string) {
  return { model_root: workspace, volume_root: volume };
}

function targets_in(workspace: string, volume = `${workspace}-volume`) {
  return company_memory_mask_targets(layout_v2, roots_in(workspace, volume));
}

describe('company_memory_mask_targets', () => {
  it('lists every layout-2 memory folder and user.md under the model root AND the raw volume root', () => {
    expect(
      company_memory_mask_targets(layout_v2, {
        model_root: '/workspace',
        volume_root: '/mnt/coworker/agents/a1/workspace',
      }),
    ).toEqual([
      ...layout_v2.memory_folders.map((folder) => ({
        target_path: `/workspace/${folder}`,
        target_kind: 'folder',
      })),
      { target_path: '/workspace/user.md', target_kind: 'file' },
      ...layout_v2.memory_folders.map((folder) => ({
        target_path: `/mnt/coworker/agents/a1/workspace/${folder}`,
        target_kind: 'folder',
      })),
      { target_path: '/mnt/coworker/agents/a1/workspace/user.md', target_kind: 'file' },
    ]);
  });
});

describe('memory_folder_mask_script', () => {
  it('mounts a read-only tmpfs on each folder, under both roots, and a read-only empty file on user.md', () => {
    const roots = { model_root: '/workspace', volume_root: '/mnt/coworker/agents/a1/workspace' };
    const script = memory_folder_mask_script(company_memory_mask_targets(layout_v2, roots), roots);

    for (const root of [roots.model_root, roots.volume_root]) {
      for (const folder of layout_v2.memory_folders) {
        expect(script).toContain(
          `mount -t tmpfs -o ro,mode=0555,size=4k coworker-memory-mask '${root}/${folder}'`,
        );
      }
      expect(script).toContain(
        `mount --bind '/run/coworker-memory-mask/empty' '${root}/user.md' && mount -o remount,bind,ro '${root}/user.md'`,
      );
      expect(script).toContain(`mount --make-private '${root}'`);
    }
  });

  it('masks once, stays idempotent, and the unmask script reverses it, on both roots', () => {
    const sandbox = create_fake_sandbox();
    const volume = `${sandbox.workspace}-volume`;
    for (const folder of ['people', 'companies', 'daily-logs']) {
      mkdirSync(path.join(volume, folder), { recursive: true });
    }
    writeFileSync(path.join(volume, 'user.md'), 'private profile\n');
    const roots = roots_in(sandbox.workspace, volume);
    const targets = targets_in(sandbox.workspace, volume);
    const mask = memory_folder_mask_script(targets, roots, sandbox.source);
    const unmask = memory_folder_unmask_script(targets, sandbox.source);
    const state = path.join(sandbox.root, 'state');
    const log = path.join(sandbox.root, 'log');

    expect(run_script(sandbox, mask)).toEqual({ exit_code: 0, stderr: '' });
    expect(run_script(sandbox, mask)).toEqual({ exit_code: 0, stderr: '' });
    expect(read_lines(state).sort()).toEqual(
      [
        sandbox.source,
        ...['companies', 'daily-logs', 'people', 'user.md'].flatMap((name) => [
          path.join(sandbox.workspace, name),
          path.join(volume, name),
        ]),
      ].sort(),
    );
    expect(read_lines(log).filter((line) => line.startsWith('mount -t tmpfs -o ro'))).toHaveLength(
      6,
    );
    expect(read_lines(log).filter((line) => line.startsWith('mount --bind'))).toHaveLength(2);
    expect(readFileSync(path.join(sandbox.workspace, 'user.md'), 'utf8')).toBe('private profile\n');

    expect(run_script(sandbox, unmask)).toEqual({ exit_code: 0, stderr: '' });
    expect(run_script(sandbox, unmask)).toEqual({ exit_code: 0, stderr: '' });
    expect(read_lines(state)).toEqual([]);
    expect(read_lines(log).filter((line) => line.startsWith('umount'))).toHaveLength(9);
  });

  it('fails loudly when a mask cannot be removed', () => {
    const sandbox = create_fake_sandbox();
    const roots = roots_in(sandbox.workspace, `${sandbox.workspace}-volume`);
    const targets = targets_in(sandbox.workspace);
    run_script(sandbox, memory_folder_mask_script(targets, roots, sandbox.source));
    writeFileSync(path.join(sandbox.bin, 'umount'), '#!/usr/bin/env bash\nexit 0\n');

    const result = run_script(sandbox, memory_folder_unmask_script(targets, sandbox.source));

    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain('A mask is still mounted on');
  });
});

describe('mask_company_memory_folders', () => {
  it('reports a provider without its own mount namespace instead of pretending', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'zq-test-memory-mask-local-'));
    created_directories.push(workspace);
    const environment = create_local_session_env({
      working_directory: workspace,
      metadata: { environment_provider: 'local' },
    });

    await expect(
      mask_company_memory_folders(
        environment,
        targets_in(workspace),
        roots_in(workspace, `${workspace}-volume`),
      ),
    ).resolves.toEqual({ mask_state: 'not_supported', environment_provider: 'local' });
  });

  it('returns a tagged failed outcome instead of throwing when the e2b runner cannot start', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'zq-test-memory-mask-e2b-fail-'));
    created_directories.push(workspace);
    const environment = create_local_session_env({
      working_directory: workspace,
      metadata: { environment_provider: 'e2b' },
    });

    const outcome = await mask_company_memory_folders(
      environment,
      targets_in(workspace),
      roots_in(workspace, `${workspace}-volume`),
    );

    expect(outcome.mask_state).toBe('failed');
    if (outcome.mask_state === 'failed') {
      expect(outcome.environment_provider).toBe('e2b');
      expect(outcome.error_message.length).toBeGreaterThan(0);
    }
  });
});

describe('mask closes the raw volume path via unshare -rm against a fake bind-mounted volume', () => {
  const run_in_namespace = (script: string) =>
    spawnSync('unshare', ['-rm', '--propagation', 'private', '--', 'bash', '-c', script], {
      encoding: 'utf8',
    });

  function build_fake_volume_and_bind(root: string) {
    const volume = path.join(root, 'volume');
    const workspace = path.join(root, 'workspace');
    mkdirSync(path.join(volume, 'people'), { recursive: true });
    writeFileSync(path.join(volume, 'people', 'alice.md'), 'VOLUME-PERSON-SECRET\n');
    mkdirSync(path.join(volume, 'notes'), { recursive: true });
    writeFileSync(path.join(volume, 'notes', 'n.md'), 'notes-visible\n');
    mkdirSync(workspace, { recursive: true });
    return { volume, workspace };
  }

  it('(a) a closed run cannot read a masked folder through the raw volume path in a shell command', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'zq-test-memory-mask-ns-raw-'));
    created_directories.push(root);
    const { volume, workspace } = build_fake_volume_and_bind(root);
    const roots = { model_root: workspace, volume_root: volume };
    const targets = company_memory_mask_targets(layout_v2, roots);
    const mask = memory_folder_mask_script(targets, roots, path.join(root, 'mask-source'));

    const result = run_in_namespace(
      [
        `mount --bind ${volume} ${workspace}`,
        mask,
        `cat ${path.join(volume, 'people', 'alice.md')} && echo RAW_READ_SUCCEEDED || echo RAW_READ_BLOCKED`,
        `cat ${path.join(workspace, 'notes', 'n.md')}`,
      ].join('\n'),
    );

    expect(result.stdout).not.toContain('VOLUME-PERSON-SECRET');
    expect(result.stdout).toContain('RAW_READ_BLOCKED');
    expect(result.stdout).toContain('notes-visible');
  });

  it('(b) a closed run cannot read a symlink in the workspace that points at the raw masked path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'zq-test-memory-mask-ns-symlink-'));
    created_directories.push(root);
    const { volume, workspace } = build_fake_volume_and_bind(root);
    const roots = { model_root: workspace, volume_root: volume };
    const targets = company_memory_mask_targets(layout_v2, roots);
    const mask = memory_folder_mask_script(targets, roots, path.join(root, 'mask-source'));
    const symlink_path = path.join(workspace, 'files', 'plink.md');

    const result = run_in_namespace(
      [
        `mount --bind ${volume} ${workspace}`,
        `mkdir -p ${path.join(workspace, 'files')}`,
        `ln -s ${path.join(volume, 'people', 'alice.md')} ${symlink_path} && echo LINK_CREATED`,
        mask,
        `cat ${symlink_path} && echo SYMLINK_READ_SUCCEEDED || echo SYMLINK_READ_BLOCKED`,
      ].join('\n'),
    );

    expect(result.stdout).toContain('LINK_CREATED');
    expect(result.stdout).not.toContain('VOLUME-PERSON-SECRET');
    expect(result.stdout).toContain('SYMLINK_READ_BLOCKED');
  });
});
