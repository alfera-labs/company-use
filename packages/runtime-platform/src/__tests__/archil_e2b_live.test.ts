import { create_browser_session } from '@agent-core/browser/browser_session';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_run_files } from '@coworker/core/db/queries/files';
import { find_volume } from '@coworker/core/db/queries/volumes';
import {
  delete_test_disk,
  read_live_test_config,
} from '@runtime-platform/__tests__/archil_live_cleanup';
import {
  bootstrap_live_test_workspace,
  create_live_workspace,
  type LiveFixture,
  provider_sandbox_id,
  save_browser_state,
  stop_live_workspace,
} from '@runtime-platform/__tests__/archil_live_fixture';
import { open_runtime_file } from '@runtime-platform/files/file_service';
import { kill_e2b_sandbox } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import type { OpenedCodingWorkspace } from '@runtime-platform/orchestrator/workspace_runtime';
import { provision_volume } from '@runtime-platform/storage/volume_provisioner';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

const live_test_enabled = env.COWORKER_ARCHIL_LIVE_TEST_ENABLED;

describe.runIf(live_test_enabled)('live Archil + R2 + E2B workspace recovery', () => {
  it(
    'preserves files, a reusable CLI, browser state, and files across sandbox replacement',
    async () => {
      const config = read_live_test_config();
      const db = await create_test_database();
      const bootstrap = await bootstrap_live_test_workspace(db);
      let provider_volume_id: string | undefined;
      let active_workspace: OpenedCodingWorkspace | undefined;
      const sandbox_ids = new Set<string>();
      let test_error: unknown;

      try {
        const volume = await provision_volume(db, {
          workspace_id: bootstrap.workspace_id,
          actor_id: bootstrap.user_id,
        });
        provider_volume_id = volume.provider_volume_id ?? undefined;
        expect(provider_volume_id).toBeTruthy();

        const first = await create_live_workspace(db, bootstrap, 'clean-a');
        active_workspace = first.workspace;
        sandbox_ids.add(provider_sandbox_id(first.workspace));
        const cli_checksum = await write_reusable_cli(first.workspace);
        await write_persistent_bytes(first.workspace, 'first sandbox');
        await save_browser_state(first.workspace);
        await save_vault_login(first.workspace);
        await stop_live_workspace(db, bootstrap, first.workspace);
        active_workspace = undefined;

        const second = await create_live_workspace(db, bootstrap, 'clean-b');
        active_workspace = second.workspace;
        sandbox_ids.add(provider_sandbox_id(second.workspace));
        expect(provider_sandbox_id(second.workspace)).not.toBe(
          provider_sandbox_id(first.workspace),
        );
        await expect(read_reusable_cli_checksum(second.workspace)).resolves.toBe(cli_checksum);
        await exercise_persistent_file_mutations(db, bootstrap, second);
        await write_persistent_bytes(second.workspace, 'second sandbox');
        await expect(read_persistent_bytes(second.workspace)).resolves.toBe('second sandbox');
        const edited_readme = await second.workspace.environment.read?.(
          'clients/acme-demo/README.md',
        );
        expect(edited_readme).toContain('edited after sandbox replacement');
        expect(edited_readme).toContain('appended by command');
        await expect(
          second.workspace.environment.exec?.({
            command: 'git',
            args: ['log', '-1', '--format=%s'],
            cwd: 'clients/acme-demo',
          }),
        ).resolves.toMatchObject({ exit_code: 0, stdout: 'Create Acme demo client\n' });
        const cli_result = await run_reusable_cli(db, bootstrap, second);
        if (!cli_result?.ok)
          throw new Error(cli_result?.error_message ?? 'CLI tool was not found.');
        const [cli_json_line = ''] = (cli_result.content_text ?? '{}').split('\n');
        expect(JSON.parse(cli_json_line)).toMatchObject({
          greeting: 'hello Mum',
          browser_probe: expect.stringContaining('persisted'),
        });
        await expect(read_browser_state(second.workspace)).resolves.toContain('persisted');
        await expect(read_vault_login(second.workspace)).resolves.toContain('vault-probe');
        const plaintext = await second.workspace.environment.exec?.({
          command: 'bash',
          args: [
            '-lc',
            "grep -R -E -l 'coworker_live_probe|persisted|vault-probe-password' /mnt/coworker/system/browser-sessions /mnt/coworker/system/browser-auth || true",
          ],
        });
        expect(plaintext?.stdout.trim()).toBe('');
        await write_artifact_with_product_tool(db, bootstrap, second);
        await stop_live_workspace(db, bootstrap, second.workspace);
        active_workspace = undefined;

        const files = await list_run_files(db, bootstrap.workspace_id, second.run.run_id);
        await expect(
          open_runtime_file(db, {
            workspace_id: bootstrap.workspace_id,
            file_id: files[0]?.file_id ?? '',
            actor_id: bootstrap.user_id,
          }),
        ).resolves.toMatchObject({
          missing: false,
          content_text: 'artifact survives sandbox death',
        });

        const crashed = await create_live_workspace(db, bootstrap, 'crashed-c');
        active_workspace = crashed.workspace;
        const crashed_sandbox_id = provider_sandbox_id(crashed.workspace);
        sandbox_ids.add(crashed_sandbox_id);
        await crashed.workspace.environment.write?.(
          'artifacts/crash-sentinel.txt',
          'survived crash',
        );
        const flushed = await crashed.workspace.environment.exec?.({
          command: 'python3',
          args: [
            '-c',
            [
              'import os',
              "file_fd = os.open('/work/artifacts/crash-sentinel.txt', os.O_RDONLY)",
              'os.fsync(file_fd)',
              'os.close(file_fd)',
              "directory_fd = os.open('/work/files', os.O_RDONLY)",
              'os.fsync(directory_fd)',
              'os.close(directory_fd)',
            ].join('; '),
          ],
          timeout_ms: 30_000,
        });
        if (flushed?.exit_code !== 0) {
          throw new Error(flushed?.stderr || flushed?.stdout || 'Crash sentinel fsync failed.');
        }
        await kill_e2b_sandbox(crashed_sandbox_id);
        active_workspace = undefined;

        const recovered = await create_live_workspace(db, bootstrap, 'recovered-d');
        active_workspace = recovered.workspace;
        sandbox_ids.add(provider_sandbox_id(recovered.workspace));
        expect(provider_sandbox_id(recovered.workspace)).not.toBe(crashed_sandbox_id);
        await expect(
          recovered.workspace.environment.read?.('artifacts/crash-sentinel.txt'),
        ).resolves.toBe('survived crash');
        await stop_live_workspace(db, bootstrap, recovered.workspace);
        active_workspace = undefined;

        await expect(find_volume(db, bootstrap.workspace_id)).resolves.toMatchObject({
          volume_status: 'active',
        });
      } catch (error) {
        test_error = error;
      }

      const cleanup_errors: unknown[] = [];
      if (active_workspace) {
        await stop_live_workspace(db, bootstrap, active_workspace).catch((error) => {
          cleanup_errors.push(error);
        });
      }
      for (const sandbox_id of sandbox_ids) {
        await kill_e2b_sandbox(sandbox_id).catch(() => undefined);
      }
      if (provider_volume_id) {
        await delete_test_disk(config, provider_volume_id, bootstrap.workspace_id).catch(
          (error) => {
            cleanup_errors.push(error);
          },
        );
      }

      if (test_error || cleanup_errors.length > 0) {
        throw new AggregateError(
          [test_error, ...cleanup_errors].filter((error) => error !== undefined),
          'The live persistent-workspace test or its cleanup failed.',
        );
      }
    },
    15 * 60_000,
  );
});

async function write_reusable_cli(workspace: OpenedCodingWorkspace) {
  await workspace.environment.exec?.({
    command: 'mkdir',
    args: ['-p', '/work/clients/acme-demo/dist', '/work/clients/acme-demo/tests'],
  });
  await workspace.environment.write?.(
    'clients/acme-demo/dist/cli.mjs',
    `import { execFileSync } from 'node:child_process';
const input = JSON.parse(process.argv[2]);
execFileSync('agent-browser', ['open', 'https://example.com'], { encoding: 'utf8' });
const browser_probe = execFileSync(
  'agent-browser',
  ['storage', 'local', 'coworker_live_probe'],
  { encoding: 'utf8' },
).trim();
process.stdout.write(JSON.stringify({ greeting: 'hello ' + input.name, browser_probe }));`,
  );
  await workspace.environment.write?.(
    'clients/acme-demo/README.md',
    [
      '# Acme demo',
      '',
      'Reusable workspace CLI for the saved Acme workflow.',
      '',
      '```bash',
      `node dist/cli.mjs '{"name":"Mum"}'`,
      '```',
    ].join('\n'),
  );
  await workspace.environment.write?.(
    'clients/acme-demo/SKILL.md',
    '# Acme demo skill\n\nUse this client for the saved Acme workflow.',
  );
  await workspace.environment.write?.(
    'clients/acme-demo/tests/cli.test.mjs',
    `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('README explains the command and the CLI uses agent-browser', async () => {
  assert.ok((await readFile(new URL('../README.md', import.meta.url), 'utf8')).includes('node dist/cli.mjs'));
  assert.match(await readFile(new URL('../dist/cli.mjs', import.meta.url), 'utf8'), /agent-browser/u);
});`,
  );
  await expect(
    workspace.environment.exec?.({
      command: 'node',
      args: ['--test', 'tests/cli.test.mjs'],
      cwd: 'clients/acme-demo',
    }),
  ).resolves.toMatchObject({ exit_code: 0 });
  await expect(workspace.environment.stat?.('clients/acme-demo/.git')).resolves.toBeNull();
  await run_git_in_demo_client(workspace, ['init']);
  await run_git_in_demo_client(workspace, ['add', '.']);
  await run_git_in_demo_client(workspace, [
    '-c',
    'user.name=Coworker',
    '-c',
    'user.email=coworker@example.test',
    'commit',
    '-m',
    'Create Acme demo client',
  ]);
  return read_reusable_cli_checksum(workspace);
}

async function run_git_in_demo_client(workspace: OpenedCodingWorkspace, args: string[]) {
  const result = await workspace.environment.exec?.({
    command: 'git',
    args,
    cwd: 'clients/acme-demo',
  });
  if (result?.exit_code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (exit ${result?.exit_code}): ${result?.stderr || result?.stdout || '(no output)'}`,
    );
  }
  return result;
}

async function read_reusable_cli_checksum(workspace: OpenedCodingWorkspace) {
  const checksum = await workspace.environment.exec?.({
    command: 'sha256sum',
    args: ['dist/cli.mjs', 'README.md', 'SKILL.md', 'tests/cli.test.mjs'],
    cwd: 'clients/acme-demo',
  });
  if (!checksum || checksum.exit_code !== 0) {
    throw new Error(checksum?.stderr || 'Could not calculate reusable CLI checksums.');
  }
  return checksum.stdout;
}

async function write_artifact_with_product_tool(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: LiveFixture,
  fixture: Awaited<ReturnType<typeof create_live_workspace>>,
) {
  const tools = create_runtime_tool_definitions(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: bootstrap.agent_id,
    runtime_environment_id: fixture.workspace.runtime_environment_id,
    environment: fixture.workspace.environment,
    actor_id: bootstrap.user_id,
  });
  const write_tool = tools.find((tool) => tool.tool_name === 'workspace-write_file');
  await expect(
    write_tool?.execute?.(
      { path: 'artifacts/after-death.txt', content: 'artifact survives sandbox death' },
      {
        run_key: fixture.run.run_id,
        session_key: fixture.session.session_id,
        metadata: {},
      },
    ),
  ).resolves.toMatchObject({ ok: true });
}

async function exercise_persistent_file_mutations(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: LiveFixture,
  fixture: Awaited<ReturnType<typeof create_live_workspace>>,
) {
  const tools = create_runtime_tool_definitions(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: bootstrap.agent_id,
    runtime_environment_id: fixture.workspace.runtime_environment_id,
    environment: fixture.workspace.environment,
    actor_id: bootstrap.user_id,
  });
  const tool_context = {
    run_key: fixture.run.run_id,
    session_key: fixture.session.session_id,
    metadata: {},
  };
  const edit_tool = tools.find((tool) => tool.tool_name === 'workspace-edit_file');
  await expect(
    edit_tool?.execute?.(
      {
        path: 'clients/acme-demo/README.md',
        old_text: '# Acme demo\n',
        new_text: '# Acme demo\nedited after sandbox replacement\n',
      },
      tool_context,
    ),
  ).resolves.toMatchObject({ ok: true });

  const run_command = tools.find((tool) => tool.tool_name === 'workspace-run_command');
  await expect(
    run_command?.execute?.(
      {
        command: 'bash',
        args: ['-lc', "printf 'appended by command\\n' >> README.md"],
        cwd: '/work/clients/acme-demo',
        writable_paths: ['/work/clients/acme-demo/README.md'],
      },
      tool_context,
    ),
  ).resolves.toMatchObject({ ok: true });
}

async function write_persistent_bytes(workspace: OpenedCodingWorkspace, contents: string) {
  if (!workspace.environment.write_bytes) {
    throw new Error('Persistent workspace byte writes are unavailable.');
  }
  await workspace.environment.write_bytes(
    'repo/outputs/upload-copy.bin',
    new Blob([contents]).stream(),
  );
}

async function read_persistent_bytes(workspace: OpenedCodingWorkspace) {
  if (!workspace.environment.read_bytes) {
    throw new Error('Persistent workspace byte reads are unavailable.');
  }
  return new TextDecoder().decode(
    await workspace.environment.read_bytes('repo/outputs/upload-copy.bin'),
  );
}

async function run_reusable_cli(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: LiveFixture,
  fixture: Awaited<ReturnType<typeof create_live_workspace>>,
) {
  const tools = create_runtime_tool_definitions(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: bootstrap.agent_id,
    runtime_environment_id: fixture.workspace.runtime_environment_id,
    environment: fixture.workspace.environment,
    actor_id: bootstrap.user_id,
  });
  const run_command = tools.find((tool) => tool.tool_name === 'workspace-run_command');
  return run_command?.execute?.(
    {
      command: 'node',
      args: ['dist/cli.mjs', JSON.stringify({ name: 'Mum' })],
      cwd: '/work/clients/acme-demo',
    },
    { run_key: fixture.run.run_id, session_key: fixture.session.session_id, metadata: {} },
  );
}

async function save_vault_login(workspace: OpenedCodingWorkspace) {
  const saved = await workspace.environment.exec?.({
    command: 'bash',
    args: [
      '-lc',
      'echo vault-probe-password | agent-browser auth save vault-probe' +
        ' --url https://example.com/login --username probe@example.com --password-stdin',
    ],
    timeout_ms: 60_000,
  });
  if (saved?.exit_code !== 0) {
    throw new Error(saved?.stderr || saved?.stdout || 'Vault login save failed.');
  }
}

async function read_vault_login(workspace: OpenedCodingWorkspace) {
  const listed = await workspace.environment.exec?.({
    command: 'agent-browser',
    args: ['auth', 'list'],
    timeout_ms: 60_000,
  });
  if (listed?.exit_code !== 0) {
    throw new Error(listed?.stderr || 'Vault login list failed.');
  }
  return listed.stdout;
}

async function read_browser_state(workspace: OpenedCodingWorkspace) {
  const browser = create_browser_session(workspace.environment, {
    default_command_timeout_ms: 90_000,
  });
  const opened = await browser.exec(['open', 'https://example.com']);
  if (opened.exit_code !== 0) throw new Error(opened.stderr || 'Browser restore launch failed.');
  const restored = await browser.exec(['storage', 'local', 'coworker_live_probe']);
  await browser.exec(['close']);
  if (restored.exit_code !== 0) throw new Error(restored.stderr || 'Browser restore read failed.');
  return restored.stdout;
}
