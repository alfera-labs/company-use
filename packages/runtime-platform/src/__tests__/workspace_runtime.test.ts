import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_run_files } from '@coworker/core/db/queries/files';
import {
  create_run,
  create_runtime_environment,
  create_session,
  get_runtime_environment,
  list_run_events,
  list_run_tool_calls,
  upsert_sandbox_by_mount_key,
} from '@coworker/core/db/queries/sessions';
import { create_volume } from '@coworker/core/db/queries/volumes';
import { open_runtime_file } from '@runtime-platform/files/file_service';
import {
  mark_coding_workspace_idle,
  open_or_create_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { afterEach, describe, expect, it, vi } from 'vitest';

const exec_file = promisify(execFile);

async function with_workspace_base<T>(test: (workspace_base_path: string) => Promise<T>) {
  const workspace_base_path = await mkdtemp(path.join(tmpdir(), 'coworker-runtime-'));
  try {
    return await test(workspace_base_path);
  } finally {
    await rm(workspace_base_path, { recursive: true, force: true });
  }
}

async function create_run_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Workspace runtime test',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });

  return { db, bootstrap, session, run };
}

async function create_second_session(
  db: Awaited<ReturnType<typeof create_run_fixture>>['db'],
  bootstrap: Awaited<ReturnType<typeof create_run_fixture>>['bootstrap'],
) {
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'A second chat in the same workspace',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  return { session, run };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('workspace runtime', () => {
  it('opens a stable local workspace with /workspace aliases and an allowlisted command env', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      vi.stubEnv('OPENAI_API_KEY', 'secret-test-key');
      const { db, bootstrap, session, run } = await create_run_fixture();

      const workspace = await open_or_create_coding_workspace(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        run_id: run.run_id,
        provider: 'local',
        workspace_base_path,
        actor_id: bootstrap.user_id,
      });

      for (const directory of ['people', 'skills', 'files', 'daily-logs', 'system']) {
        expect(existsSync(path.join(workspace.host_workspace_root, directory))).toBe(true);
      }

      await workspace.environment.write?.('/workspace/files/todo.txt', 'buy milk');
      expect(await workspace.environment.read?.('files/todo.txt')).toBe('buy milk');

      const command = await workspace.environment.exec?.({
        command: 'node',
        args: [
          '-e',
          [
            'process.stdout.write(JSON.stringify({',
            'openai: process.env.OPENAI_API_KEY ?? null,',
            'workspaceRoot: process.env.COWORKER_WORKSPACE_ROOT,',
            'hostWorkspaceRoot: process.env.COWORKER_HOST_WORKSPACE_ROOT,',
            'home: process.env.HOME,',
            'tmpdir: process.env.TMPDIR,',
            'cwd: process.cwd()',
            '}))',
          ].join(''),
        ],
      });
      expect(JSON.parse(command?.stdout ?? '{}')).toEqual({
        openai: null,
        workspaceRoot: '/workspace',
        hostWorkspaceRoot: workspace.host_workspace_root,
        home: workspace.host_workspace_root,
        tmpdir: path.join(workspace.host_workspace_root, 'tmp'),
        cwd: workspace.host_workspace_root,
      });

      const runtime_environment = await get_runtime_environment(db, {
        workspace_id: bootstrap.workspace_id,
        runtime_environment_id: workspace.runtime_environment_id,
      });
      expect(runtime_environment).toMatchObject({
        environment_provider: 'local',
        environment_status: 'running',
        workspace_mount_key: `${bootstrap.workspace_id}:${session.session_id}`,
      });
    });
  });

  it('opens a docker workspace as a non-root /workspace sandbox with an allowlisted command env', async ({
    skip,
  }) => {
    skip(!(await docker_available()), docker_is_not_here);

    await with_workspace_base(async (workspace_base_path) => {
      vi.stubEnv('OPENAI_API_KEY', 'secret-test-key');
      const { db, bootstrap, session, run } = await create_run_fixture();
      const workspace = await open_or_create_coding_workspace(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        run_id: run.run_id,
        provider: 'docker',
        workspace_base_path,
        actor_id: bootstrap.user_id,
      });

      try {
        expect(workspace.environment.working_directory).toBe('/workspace');
        await workspace.environment.write?.('/workspace/files/docker.txt', 'docker ok');
        await expect(workspace.environment.read?.('files/docker.txt')).resolves.toBe('docker ok');

        const command = await workspace.environment.exec?.({
          command: 'node',
          args: [
            '-e',
            [
              'process.stdout.write(JSON.stringify({',
              'uid: process.getuid?.(),',
              'openai: process.env.OPENAI_API_KEY ?? null,',
              'database: process.env.DATABASE_URL ?? null,',
              'root: process.env.COWORKER_WORKSPACE_ROOT,',
              'home: process.env.HOME,',
              'cwd: process.cwd()',
              '}))',
            ].join(''),
          ],
        });
        expect(JSON.parse(command?.stdout ?? '{}')).toEqual({
          uid: 1000,
          openai: null,
          database: null,
          root: '/workspace',
          home: '/workspace/tmp/home',
          cwd: '/workspace',
        });
      } finally {
        await remove_docker_container(workspace);
      }
    });
  });

  it('gives two docker sessions of one workspace the same folder and their own tmp/', async ({
    skip,
  }) => {
    skip(!(await docker_available()), docker_is_not_here);

    await with_workspace_base(async (workspace_base_path) => {
      const { db, bootstrap, session, run } = await create_run_fixture();
      const other = await create_second_session(db, bootstrap);
      const open = (session_id: string, run_id: string) =>
        open_or_create_coding_workspace(db, {
          workspace_id: bootstrap.workspace_id,
          session_id,
          agent_id: bootstrap.agent_id,
          run_id,
          provider: 'docker',
          workspace_base_path,
          actor_id: bootstrap.user_id,
        });
      const first = await open(session.session_id, run.run_id);
      const second = await open(other.session.session_id, other.run.run_id);
      const shell = (workspace: typeof first, script: string) =>
        workspace.environment.exec?.({ command: 'sh', args: ['-c', script] });

      try {
        expect(first.host_workspace_root).toBe(second.host_workspace_root);
        await shell(
          first,
          'echo lasting > /workspace/files/from-shell.txt && echo alias > /work/files/alias.txt && echo private > tmp/scratch.txt && echo home > "$HOME/.rc"',
        );
        await first.environment.write?.('tmp/from-tool.txt', 'tool scratch');

        expect(await first.environment.read?.('files/from-shell.txt')).toBe('lasting\n');
        expect(await first.environment.read?.('tmp/scratch.txt')).toBe('private\n');
        await expect(shell(first, 'cat /workspace/tmp/from-tool.txt')).resolves.toMatchObject({
          stdout: 'tool scratch',
        });
        await expect(
          shell(second, 'cat /workspace/files/from-shell.txt files/alias.txt'),
        ).resolves.toMatchObject({ exit_code: 0, stdout: 'lasting\nalias\n' });
        await expect(
          shell(second, 'ls /workspace/tmp/scratch.txt /workspace/tmp/home/.rc'),
        ).resolves.toMatchObject({ exit_code: 2 });
        await expect(second.environment.read?.('tmp/scratch.txt')).rejects.toThrow(/ENOENT/);
        await expect(readdir(path.join(first.host_workspace_root, 'tmp'))).resolves.toEqual([]);
      } finally {
        await remove_docker_container(first);
        await remove_docker_container(second);
      }
    });
  });

  it('routes source file tools to the workspace root and blocks background server commands', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const { db, bootstrap, session, run } = await create_run_fixture();
      const workspace = await open_or_create_coding_workspace(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        run_id: run.run_id,
        provider: 'local',
        workspace_base_path,
        actor_id: bootstrap.user_id,
      });
      const tools = create_runtime_tool_definitions(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: run.run_id,
        agent_id: bootstrap.agent_id,
        runtime_environment_id: workspace.runtime_environment_id,
        environment: workspace.environment,
        actor_id: bootstrap.user_id,
      });
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
      const context = {
        run_key: run.run_id,
        session_key: session.session_id,
        metadata: {},
      };

      await expect(
        tool_by_name
          .get('workspace-write_file')
          ?.execute?.({ path: 'package.json', content: '{"scripts":{}}' }, context),
      ).resolves.toMatchObject({ ok: true });
      await expect(workspace.environment.read?.('package.json')).resolves.toBe('{"scripts":{}}');
      await expect(
        tool_by_name
          .get('workspace-write_file')
          ?.execute?.({ path: 'tools/demo/README.md', content: '# Demo' }, context),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        tool_by_name
          .get('workspace-write_file')
          ?.execute?.({ path: 'WORKSPACE.md', content: '# Workspace index' }, context),
      ).resolves.toMatchObject({ ok: true });
      await expect(workspace.environment.read?.('tools/demo/README.md')).resolves.toBe('# Demo');
      await expect(workspace.environment.read?.('WORKSPACE.md')).resolves.toBe('# Workspace index');
      await expect(
        tool_by_name.get('workspace-read_file')?.execute?.({ path: 'package.json' }, context),
      ).resolves.toMatchObject({ ok: true, content_text: '{"scripts":{}}' });
      await expect(
        tool_by_name.get('workspace-run_command')?.execute?.(
          {
            command: 'sh',
            args: ['-c', 'nohup npm run start > /workspace/tmp/app.log 2>&1 &'],
          },
          context,
        ),
      ).resolves.toMatchObject({
        ok: false,
        error_code: 'blocked_by_policy',
      });
    });
  });

  it('rejects lexical path escapes and symlinks that resolve outside the workspace', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const { db, bootstrap, session, run } = await create_run_fixture();
      const workspace = await open_or_create_coding_workspace(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        run_id: run.run_id,
        provider: 'local',
        workspace_base_path,
        actor_id: bootstrap.user_id,
      });
      const tools = create_runtime_tool_definitions(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: run.run_id,
        agent_id: bootstrap.agent_id,
        runtime_environment_id: workspace.runtime_environment_id,
        environment: workspace.environment,
        actor_id: bootstrap.user_id,
      });
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
      const outside_directory = await mkdtemp(path.join(tmpdir(), 'coworker-escape-'));
      await writeFile(path.join(outside_directory, 'secret.txt'), 'secret', 'utf8');
      await symlink(
        path.join(outside_directory, 'secret.txt'),
        path.join(workspace.host_workspace_root, 'files', 'escape.txt'),
      );
      const context = {
        run_key: run.run_id,
        session_key: session.session_id,
        metadata: {},
      };

      await expect(
        tool_by_name.get('workspace-read_file')?.execute?.({ path: '/etc/passwd' }, context),
      ).resolves.toMatchObject({ ok: false, error_code: 'path_escape' });
      await expect(
        tool_by_name.get('workspace-read_file')?.execute?.({ path: 'files/escape.txt' }, context),
      ).resolves.toMatchObject({ ok: false, error_code: 'symlink_escape' });
    });
  });

  it('records workspace coding tools and opens produced files after the run process ends', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const { db, bootstrap, session, run } = await create_run_fixture();
      const workspace = await open_or_create_coding_workspace(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        run_id: run.run_id,
        provider: 'local',
        workspace_base_path,
        actor_id: bootstrap.user_id,
      });
      const tools = create_runtime_tool_definitions(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: run.run_id,
        agent_id: bootstrap.agent_id,
        runtime_environment_id: workspace.runtime_environment_id,
        environment: workspace.environment,
        actor_id: bootstrap.user_id,
      });
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
      const context = {
        run_key: run.run_id,
        session_key: session.session_id,
        metadata: {},
      };

      await expect(
        tool_by_name
          .get('workspace-write_file')
          ?.execute?.({ path: '/workspace/files/todo.txt', content: 'buy milk' }, context),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        tool_by_name.get('workspace-read_file')?.execute?.({ path: 'files/todo.txt' }, context),
      ).resolves.toMatchObject({
        ok: true,
        content_text: 'buy milk',
      });
      await expect(
        tool_by_name.get('workspace-run_command')?.execute?.(
          {
            command: 'node',
            args: ['-e', 'process.stdout.write(process.env.OPENAI_API_KEY ?? "absent")'],
          },
          context,
        ),
      ).resolves.toMatchObject({
        ok: true,
        content_text: 'absent',
      });

      const tool_calls = await list_run_tool_calls(db, bootstrap.workspace_id, run.run_id);
      expect(tool_calls.map((tool_call) => tool_call.tool_name)).toEqual([
        'workspace-write_file',
        'workspace-read_file',
        'workspace-run_command',
      ]);
      expect(tool_calls[0]).toMatchObject({
        risk_class: 'write',
        approval_mode: 'auto',
        tool_call_metadata: expect.objectContaining({
          runtime_environment_id: workspace.runtime_environment_id,
        }),
      });
      const first_tool_call_id = tool_calls[0]?.tool_call_id;
      expect(first_tool_call_id).toBeTruthy();
      const linked_events = await list_run_events(db, bootstrap.workspace_id, run.run_id, {
        tool_call_id: first_tool_call_id ?? '',
      });
      expect(linked_events.map((event) => event.event_label)).toEqual([
        'tool_call.started',
        'tool_call.completed',
      ]);

      const files = await list_run_files(db, bootstrap.workspace_id, run.run_id);
      expect(files).toEqual([
        expect.objectContaining({
          runtime_environment_id: workspace.runtime_environment_id,
          source_tool_call_id: tool_calls[0]?.tool_call_id,
          file_purpose: 'file',
          file_status: 'ready',
          storage_provider: 'local_workspace',
          storage_key: 'files/todo.txt',
          workspace_path: 'files/todo.txt',
          byte_size: 8,
          checksum_sha256: expect.any(String),
          content_preview: 'buy milk',
          is_visible: true,
        }),
      ]);

      const opened_artifact = await open_runtime_file(db, {
        workspace_id: bootstrap.workspace_id,
        file_id: files[0]?.file_id ?? '',
        actor_id: bootstrap.user_id,
      });
      expect(opened_artifact).toMatchObject({
        missing: false,
        content_text: 'buy milk',
        byte_size: 8,
      });
    });
  });

  it('closes a stopped persistent sandbox once across concurrent close retries', async () => {
    const { db, bootstrap, session } = await create_run_fixture();
    const volume = await create_volume(db, {
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'active',
      provider_volume_id: 'dsk_closed_workspace',
      provider_region: 'aws-us-east-1',
      actor_id: bootstrap.user_id,
    });
    const workspace_mount_key = `workspace:${bootstrap.workspace_id}:${session.session_id}`;
    const runtime_environment = await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: null,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'sbox_closed_workspace',
      workspace_mount_key,
      root_path: '/workspace',
      environment_metadata: {
        volume_id: volume.volume_id,
        volume_provider: 'archil',
        volume_root_path: '/mnt/coworker',
      },
      actor_id: bootstrap.user_id,
    });
    await upsert_sandbox_by_mount_key(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_id: session.session_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
      sandbox_provider: 'e2b',
      sandbox_status: 'stopped',
      provider_sandbox_id: 'sbox_closed_workspace',
      workspace_mount_key,
      root_path: '/workspace',
      working_directory: '/workspace',
      actor_id: bootstrap.user_id,
    });
    const close_input = {
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
      close_token: { provider_environment_id: 'sbox_closed_workspace' },
      actor_id: bootstrap.user_id,
    };

    const closed = await Promise.all([
      mark_coding_workspace_idle(db, close_input),
      mark_coding_workspace_idle(db, close_input),
    ]);
    expect(closed.some((environment) => environment.environment_status === 'idle')).toBe(true);
    expect(
      closed.every((environment) => ['idle', 'stopping'].includes(environment.environment_status)),
    ).toBe(true);
    await expect(mark_coding_workspace_idle(db, close_input)).resolves.toMatchObject({
      environment_status: 'idle',
    });
  });

  it('rejects a close whose token names a different sandbox', async () => {
    const { db, bootstrap, session } = await create_run_fixture();
    const workspace_mount_key = `workspace:${bootstrap.workspace_id}:${session.session_id}`;
    const runtime_environment = await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: null,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'sbox_owner',
      workspace_mount_key,
      root_path: '/workspace',
      environment_metadata: { volume_id: 'vol_x', volume_provider: 'archil' },
      actor_id: bootstrap.user_id,
    });

    await expect(
      mark_coding_workspace_idle(db, {
        workspace_id: bootstrap.workspace_id,
        runtime_environment_id: runtime_environment.runtime_environment_id,
        close_token: { provider_environment_id: 'sbox_stale' },
        actor_id: bootstrap.user_id,
      }),
    ).rejects.toMatchObject({ code: 'stale_workspace_close' });
  });
});

const docker_is_not_here = 'Docker with the node:24-bookworm image is not on this machine';

async function docker_available() {
  try {
    await exec_file('docker', ['info']);
    await exec_file('docker', ['image', 'inspect', 'node:24-bookworm']);
    return true;
  } catch {
    return false;
  }
}

async function remove_docker_container(workspace: {
  environment: { metadata?: Record<string, unknown> };
}) {
  const container_name = workspace.environment.metadata?.provider_environment_id;
  if (typeof container_name !== 'string' || container_name.length === 0) return;
  await exec_file('docker', ['rm', '-f', container_name]).catch(() => undefined);
}
