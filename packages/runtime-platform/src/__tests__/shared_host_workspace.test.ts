import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_runtime_environment,
  create_session,
  get_runtime_environment,
} from '@coworker/core/db/queries/sessions';
import { read_sandbox_file_bytes } from '@runtime-platform/files/read_sandbox_file_bytes';
import { content_version_for_bytes } from '@runtime-platform/files/workspace_file_content';
import {
  list_workspace_volume_folder,
  read_workspace_volume_file,
  replace_workspace_volume_file,
  resolve_workspace_volume_address,
  write_workspace_volume_file,
} from '@runtime-platform/files/workspace_volume_browser';
import { open_or_create_coding_workspace } from '@runtime-platform/orchestrator/workspace_runtime';
import { compile_workspace_skill_index } from '@runtime-platform/skills/compile_workspace_skill_index';
import { read_workspace_skill_index } from '@runtime-platform/skills/read_workspace_skill_index';
import { unindexed_skill_hint } from '@runtime-platform/skills/skill_index_artifact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const weekly_cash_note = `---
name: weekly-cash-note
description: Write the weekly cash note from the bank export.
---

1. Read the export.
`;

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

let docker_calls_path: string;

beforeEach(async () => {
  const stub_directory = await mkdtemp(path.join(tmpdir(), 'stub-docker-cli-'));
  docker_calls_path = path.join(stub_directory, 'calls.log');
  const docker_that_logs_one_line_a_call_and_knows_a_container_once_it_ran = [
    '#!/bin/sh',
    `calls="${docker_calls_path}"`,
    `printf '%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" >> "$calls"`,
    '[ "$1" = inspect ] || exit 0',
    `grep -q '^run --detach' "$calls" || exit 1`,
    'echo 2026-10-12T01:00:00.000000000Z',
  ].join('\n');
  const stub = docker_that_logs_one_line_a_call_and_knows_a_container_once_it_ran;
  await writeFile(path.join(stub_directory, 'docker'), stub, { mode: 0o755 });
  vi.stubEnv('PATH', `${stub_directory}${path.delimiter}${process.env.PATH}`);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(path.dirname(docker_calls_path), { recursive: true, force: true });
});

async function read_docker_calls() {
  return (await readFile(docker_calls_path, 'utf8')).trim().split('\n');
}

async function with_workspace_base<T>(test: (workspace_base_path: string) => Promise<T>) {
  const workspace_base_path = await mkdtemp(path.join(tmpdir(), 'coworker-shared-'));
  try {
    return await test(workspace_base_path);
  } finally {
    await rm(workspace_base_path, { recursive: true, force: true });
  }
}

async function create_workspace_fixture(workspace_base_path: string) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const owner = {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    workspace_runtime_provider: 'docker' as const,
    workspace_base_path,
  };
  const open_chat = async (session_title: string) => {
    const session = await create_session(db, {
      ...owner,
      session_title,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      ...owner,
      session_id: session.session_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    return open_or_create_coding_workspace(db, {
      ...owner,
      session_id: session.session_id,
      run_id: run.run_id,
      provider: 'docker',
      actor_id: bootstrap.user_id,
    });
  };
  return { db, bootstrap, owner, open_chat };
}

async function require_address(fixture: Awaited<ReturnType<typeof create_workspace_fixture>>) {
  const address = await resolve_workspace_volume_address(fixture.db, fixture.owner);
  if (!address) throw new Error('The workspace has no folder on this machine yet.');
  return address;
}

describe('one lasting folder per workspace on this machine', () => {
  it('shows a second chat the file and the procedure the first chat wrote', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const first = await fixture.open_chat('Chat 1');
      await first.environment.write?.('audit-note.md', 'cash is fine');
      await first.environment.write?.('skills/weekly-cash-note/SKILL.md', weekly_cash_note);
      await compile_workspace_skill_index(first.environment);

      const second = await fixture.open_chat('Chat 2');

      expect(second.runtime_environment_id).not.toBe(first.runtime_environment_id);
      expect(second.host_workspace_root).toBe(
        path.join(
          await realpath(workspace_base_path),
          fixture.owner.workspace_id,
          'volume/agents',
          fixture.owner.agent_id,
          'workspace',
        ),
      );
      expect(await second.environment.read?.('audit-note.md')).toBe('cash is fine');
      expect(await second.environment.read?.('skills/weekly-cash-note/SKILL.md')).toBe(
        weekly_cash_note,
      );
      const index = await read_workspace_skill_index(fixture.db, fixture.owner);
      expect(index.entries).toEqual([
        expect.objectContaining({
          skill_slug: 'weekly-cash-note',
          skill_hint: 'Write the weekly cash note from the bank export.',
          body_path: 'skills/weekly-cash-note/SKILL.md',
        }),
      ]);
    });
  });

  it('offers a procedure from its folder when no index was compiled', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const chat = await fixture.open_chat('Chat 1');
      await chat.environment.write?.('skills/weekly-cash-note/SKILL.md', weekly_cash_note);

      const index = await read_workspace_skill_index(fixture.db, fixture.owner);

      expect(index.entries).toEqual([
        expect.objectContaining({
          skill_slug: 'weekly-cash-note',
          skill_hint: unindexed_skill_hint,
        }),
      ]);
    });
  });

  it('starts one sandbox per chat with the shared folder and its own scratch at /workspace', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const chat = await fixture.open_chat('Chat 1');
      const scratch = path.join(await realpath(workspace_base_path), fixture.owner.workspace_id);
      const mount = (source: string, target: string) =>
        `--mount type=bind,source=${source},target=${target}`;

      await chat.environment.exec?.({ command: 'ls', args: ['files'], cwd: 'files' });

      const [
        network,
        inspect,
        image_check,
        run,
        started_before,
        guard,
        started,
        started_again,
        exec,
      ] = await read_docker_calls();
      expect(network).toBe('network inspect alfera-sandbox');
      expect(image_check).toBe('image inspect --format {{.Id}} node:24-bookworm');
      const container_name = inspect?.split(' ').at(-1);
      expect(container_name).toMatch(/^coworker-workspace-[a-z0-9_-]+$/u);
      expect(run).toContain(
        `run --detach --name ${container_name} --network alfera-sandbox --sysctl net.ipv6.conf.all.disable_ipv6=1 --dns 1.1.1.1 --dns 9.9.9.9 --user node --workdir /workspace`,
      );
      expect(guard).toContain(`run --rm --network container:${container_name} --cap-add NET_ADMIN`);
      expect(guard).toContain('ip route replace unreachable');
      expect([started_before, started, started_again]).toEqual(
        Array.from({ length: 3 }, () => `inspect --format {{.State.StartedAt}} ${container_name}`),
      );
      expect(run).toContain(mount(chat.host_workspace_root, '/workspace'));
      expect(run).toContain(mount(chat.host_workspace_root, '/work'));
      expect(run).toMatch(
        new RegExp(`${mount(`${scratch}/[A-Za-z0-9_-]+/tmp`, '/workspace/tmp')} `, 'u'),
      );
      expect(run).toContain('--security-opt no-new-privileges');
      expect(exec).toMatch(/^exec --workdir \/workspace\/files --env /u);
      expect(exec).toContain('HOME=/workspace/tmp/home');
      expect(exec).toContain(`${container_name} ls files`);
    });
  });

  it('keeps the scratch of one chat out of the next chat', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const first = await fixture.open_chat('Chat 1');
      const second = await fixture.open_chat('Chat 2');

      await first.environment.write?.('tmp/draft.md', 'first chat only');

      expect(await first.environment.read?.('tmp/draft.md')).toBe('first chat only');
      await expect(second.environment.read?.('tmp/draft.md')).rejects.toThrow(/ENOENT/);
    });
  });

  it('keeps the one-folder-per-chat layout on the local provider', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const on_local = { ...fixture.owner, workspace_runtime_provider: 'local' as const };
      await fixture.open_chat('Chat 1');

      await expect(resolve_workspace_volume_address(fixture.db, on_local)).resolves.toBeNull();
      await expect(read_workspace_skill_index(fixture.db, on_local)).resolves.toMatchObject({
        entries: [],
      });
    });
  });

  it('has no folder to read before the first run, and none at all on managed sandboxes', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);

      await expect(resolve_workspace_volume_address(fixture.db, fixture.owner)).resolves.toBeNull();
      await expect(read_workspace_skill_index(fixture.db, fixture.owner)).resolves.toMatchObject({
        entries: [],
      });

      await fixture.open_chat('Chat 1');
      const on_managed_sandboxes = { ...fixture.owner, workspace_runtime_provider: 'e2b' as const };
      await expect(
        resolve_workspace_volume_address(fixture.db, on_managed_sandboxes),
      ).resolves.toBeNull();
      await expect(
        resolve_workspace_volume_address(fixture.db, fixture.owner),
      ).resolves.toMatchObject({ host_workspace_root: expect.stringContaining('/volume/agents/') });
    });
  });
});

describe('a chat that ran before the workspace had one shared folder', () => {
  it('keeps its old environment record, so files it made earlier still open', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const session = await create_session(fixture.db, {
        ...fixture.owner,
        session_title: 'An older chat',
        actor_id: fixture.bootstrap.user_id,
      });
      const run = await create_run(fixture.db, {
        ...fixture.owner,
        session_id: session.session_id,
        trigger_type: 'user_message',
        actor_id: fixture.bootstrap.user_id,
      });
      const old_folder = path.join(workspace_base_path, 'old', session.session_id, 'work');
      const before = await create_runtime_environment(fixture.db, {
        workspace_id: fixture.owner.workspace_id,
        session_id: session.session_id,
        agent_id: fixture.owner.agent_id,
        environment_provider: 'docker',
        environment_status: 'idle',
        workspace_mount_key: `${fixture.owner.workspace_id}:${session.session_id}`,
        root_path: old_folder,
        environment_metadata: { host_workspace_root: old_folder },
        actor_id: fixture.bootstrap.user_id,
      });

      const opened = await open_or_create_coding_workspace(fixture.db, {
        ...fixture.owner,
        session_id: session.session_id,
        run_id: run.run_id,
        provider: 'docker',
        actor_id: fixture.bootstrap.user_id,
      });

      expect(opened.runtime_environment_id).not.toBe(before.runtime_environment_id);
      await expect(
        get_runtime_environment(fixture.db, {
          workspace_id: fixture.owner.workspace_id,
          runtime_environment_id: before.runtime_environment_id,
        }),
      ).resolves.toMatchObject({
        environment_status: 'idle',
        environment_metadata: { host_workspace_root: old_folder },
      });
    });
  });
});

describe('browsing the workspace folder on this machine', () => {
  it('lists, opens, writes and replaces the files a chat left there', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const chat = await fixture.open_chat('Chat 1');
      await chat.environment.write?.('files/audit-note.md', 'cash is fine');
      const address = await require_address(fixture);

      const root = await list_workspace_volume_folder(address, '');
      expect(root.folder_names).toEqual(expect.arrayContaining(['files', 'skills', 'system']));
      await expect(list_workspace_volume_folder(address, 'files/')).resolves.toEqual({
        folder_names: [],
        files: [
          {
            file_name: 'audit-note.md',
            byte_size: 12,
            last_modified_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
          },
        ],
      });
      const opened = await read_workspace_volume_file(address, 'files/audit-note.md');
      expect(text(opened)).toBe('cash is fine');

      await write_workspace_volume_file(address, {
        file_path: 'goals/new/plan.md',
        data: bytes('a plan'),
      });
      expect(await chat.environment.read?.('goals/new/plan.md')).toBe('a plan');

      await replace_workspace_volume_file(address, {
        file_path: 'files/audit-note.md',
        data: bytes('cash is tight'),
        expected_version: content_version_for_bytes(opened),
        content_version: content_version_for_bytes(bytes('cash is tight')),
      });
      expect(await chat.environment.read?.('files/audit-note.md')).toBe('cash is tight');
      await expect(list_workspace_volume_folder(address, 'files')).resolves.toMatchObject({
        files: [{ file_name: 'audit-note.md' }],
      });
    });
  });

  it('refuses a save over a file that changed since it was opened', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const chat = await fixture.open_chat('Chat 1');
      await chat.environment.write?.('files/audit-note.md', 'written by the agent since');
      const address = await require_address(fixture);

      await expect(
        replace_workspace_volume_file(address, {
          file_path: 'files/audit-note.md',
          data: bytes('my edit'),
          expected_version: content_version_for_bytes(bytes('what I opened')),
          content_version: content_version_for_bytes(bytes('my edit')),
        }),
      ).rejects.toMatchObject({
        code: 'workspace_file_version_conflict',
        status: 409,
        details: {
          content_version: content_version_for_bytes(bytes('written by the agent since')),
        },
      });
      expect(await chat.environment.read?.('files/audit-note.md')).toBe(
        'written by the agent since',
      );
    });
  });

  it('answers 404 for a missing file, a missing folder, and a folder opened as a file', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      await fixture.open_chat('Chat 1');
      const address = await require_address(fixture);
      const not_found = { code: 'workspace_file_not_found', status: 404 };

      await expect(read_workspace_volume_file(address, 'files/none.md')).rejects.toMatchObject(
        not_found,
      );
      await expect(list_workspace_volume_folder(address, 'no-such')).rejects.toMatchObject(
        not_found,
      );
      await expect(read_workspace_volume_file(address, 'files')).rejects.toMatchObject(not_found);
    });
  });
});

describe('keeping every read and write inside the workspace folder', () => {
  async function two_workspaces_on_one_disk(workspace_base_path: string) {
    const fixture = await create_workspace_fixture(workspace_base_path);
    const chat = await fixture.open_chat('Chat 1');
    const address = await require_address(fixture);
    const other_workspace = path.join(
      workspace_base_path,
      'ws_other/volume/agents/agt_1/workspace',
    );
    await mkdir(path.join(other_workspace, 'files'), { recursive: true });
    await writeFile(path.join(other_workspace, 'files/secret.md'), 'other workspace', 'utf8');
    return { address, other_workspace, host_workspace_root: chat.host_workspace_root };
  }
  const outside = { code: 'workspace_path_invalid', status: 400 };

  it.each([
    '../../../../../ws_other/volume/agents/agt_1/workspace/files/secret.md',
    'files/../../../../../../ws_other/volume/agents/agt_1/workspace/files/secret.md',
    '/etc/passwd',
    'files/\0secret.md',
  ])('refuses the path %j', async (file_path) => {
    await with_workspace_base(async (workspace_base_path) => {
      const { address } = await two_workspaces_on_one_disk(workspace_base_path);

      await expect(read_workspace_volume_file(address, file_path)).rejects.toMatchObject(outside);
      await expect(list_workspace_volume_folder(address, file_path)).rejects.toMatchObject(outside);
      await expect(
        write_workspace_volume_file(address, { file_path, data: bytes('x') }),
      ).rejects.toMatchObject(outside);
    });
  });

  it('refuses an absolute path even when it points inside the workspace', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const { address, host_workspace_root } =
        await two_workspaces_on_one_disk(workspace_base_path);

      await expect(
        read_workspace_volume_file(address, path.join(host_workspace_root, 'README.md')),
      ).rejects.toMatchObject(outside);
    });
  });

  it('refuses a symlink the agent planted that points at another workspace', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const disk = await two_workspaces_on_one_disk(workspace_base_path);
      await symlink(
        path.join(disk.other_workspace, 'files/secret.md'),
        path.join(disk.host_workspace_root, 'files/link.md'),
      );
      await symlink(disk.other_workspace, path.join(disk.host_workspace_root, 'files/door'));

      await expect(read_workspace_volume_file(disk.address, 'files/link.md')).rejects.toMatchObject(
        outside,
      );
      await expect(
        read_workspace_volume_file(disk.address, 'files/door/files/secret.md'),
      ).rejects.toMatchObject(outside);
      await expect(list_workspace_volume_folder(disk.address, 'files/door')).rejects.toMatchObject(
        outside,
      );
      await expect(
        write_workspace_volume_file(disk.address, {
          file_path: 'files/door/new/planted.md',
          data: bytes('x'),
        }),
      ).rejects.toMatchObject(outside);
      await expect(
        write_workspace_volume_file(disk.address, { file_path: 'files/link.md', data: bytes('x') }),
      ).rejects.toMatchObject(outside);
      await expect(
        replace_workspace_volume_file(disk.address, {
          file_path: 'files/link.md',
          data: bytes('x'),
          expected_version: content_version_for_bytes(bytes('other workspace')),
          content_version: content_version_for_bytes(bytes('x')),
        }),
      ).rejects.toMatchObject(outside);

      expect(await readFile(path.join(disk.other_workspace, 'files/secret.md'), 'utf8')).toBe(
        'other workspace',
      );
      await expect(readFile(path.join(disk.other_workspace, 'new/planted.md'))).rejects.toThrow(
        /ENOENT/,
      );
      await expect(list_workspace_volume_folder(disk.address, 'files')).resolves.toEqual({
        folder_names: [],
        files: [],
      });
    });
  });
});

describe('opening a file a docker session kept under tmp/', () => {
  it('reads it from that session scratch folder, not from the shared folder', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_workspace_fixture(workspace_base_path);
      const chat = await fixture.open_chat('Chat 1');
      const host_scratch_root = path.join(workspace_base_path, 'scratch');
      await mkdir(host_scratch_root);
      await writeFile(path.join(host_scratch_root, 'chart.png'), 'png bytes', 'utf8');
      const runtime_environment = await create_runtime_environment(fixture.db, {
        workspace_id: fixture.owner.workspace_id,
        session_id: null,
        agent_id: fixture.owner.agent_id,
        environment_provider: 'docker',
        environment_status: 'idle',
        workspace_mount_key: 'workspace:test:scratch',
        root_path: '/workspace',
        environment_metadata: { host_workspace_root: chat.host_workspace_root, host_scratch_root },
        actor_id: fixture.bootstrap.user_id,
      });

      const read = await read_sandbox_file_bytes(fixture.db, {
        workspace_id: fixture.owner.workspace_id,
        runtime_environment,
        host_workspace_root: chat.host_workspace_root,
        workspace_path: 'tmp/chart.png',
      });

      expect(text(read)).toBe('png bytes');
    });
  });
});
