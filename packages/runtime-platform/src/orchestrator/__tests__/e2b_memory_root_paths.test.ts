import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake_sandbox = vi.hoisted(() => ({
  sandboxId: 'zq-test-sandbox',
  getHost: () => 'zq-test-host',
  commands_run: [] as string[],
  files_written: [] as string[],
  list_result: [] as { name: string; path: string; type: string }[],
  grep_stdout: '',
}));

vi.mock('e2b', () => {
  class CommandExitError extends Error {}
  class FileNotFoundError extends Error {}
  const sandbox = {
    sandboxId: fake_sandbox.sandboxId,
    getHost: fake_sandbox.getHost,
    files: {
      write: async (target_path: string) => {
        fake_sandbox.files_written.push(target_path);
      },
      getInfo: async () => ({}),
      list: async () => fake_sandbox.list_result,
    },
    commands: {
      run: async (command: string) => {
        fake_sandbox.commands_run.push(command);
        if (command.includes('--no-heading')) {
          return {
            exitCode: 0,
            stdout: fake_sandbox.grep_stdout,
            stderr: 'coworker-searcher-exit:0',
          };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    },
  };
  return {
    CommandExitError,
    FileNotFoundError,
    Sandbox: { connect: async () => sandbox },
    SandboxNotFoundError: class SandboxNotFoundError extends Error {},
    TimeoutError: class TimeoutError extends Error {},
  };
});

const volume = {
  volume_id: 'zq-test-volume',
  workspace_mount_key: 'workspace:zq-test-ws:zq-test-session',
  provider: 'archil' as const,
  workspace_layout_version: 2,
  provider_volume_id: 'zq-test-disk',
  provider_region: 'aws-us-west-2',
  root_path: '/mnt/coworker',
  mount_token: 'zq-test-token',
};

async function connect_memory_environment(memory_root_open_slugs: string[]) {
  const { connect_e2b_session_env } = await import(
    '@runtime-platform/orchestrator/e2b_sandbox_client'
  );
  const environment = await connect_e2b_session_env({
    runtime_environment_id: 'zq-test-runtime-environment',
    sandbox_id: fake_sandbox.sandboxId,
    workspace_mount_key: volume.workspace_mount_key,
    run_id: 'zq-test-run',
    agent_id: 'zq-test-agent',
    host_workspace_root: '/tmp/zq-test',
    workspace_directories: [],
    volume,
    memory_root_open_slugs,
  });
  if (!environment) throw new Error('The fake sandbox did not connect.');
  fake_sandbox.commands_run.length = 0;
  fake_sandbox.files_written.length = 0;
  return environment;
}

const archil_commands = () =>
  fake_sandbox.commands_run.filter((command) => command.startsWith("'archil'"));

beforeEach(() => {
  fake_sandbox.commands_run.length = 0;
  fake_sandbox.files_written.length = 0;
  fake_sandbox.list_result = [];
  fake_sandbox.grep_stdout = '';
});

describe('E2B mapping for the /memory path class', () => {
  it('writes an open scope file on sandbox-local disk with no Archil checkout', async () => {
    const environment = await connect_memory_environment(['demo']);

    await environment.write?.('/memory/demo/notes/a.md', 'alpha');

    expect(fake_sandbox.files_written).toEqual(['/memory/demo/notes/a.md']);
    expect(archil_commands()).toEqual([]);
  });

  it('runs a command that declares open scope folders without an Archil checkout', async () => {
    const environment = await connect_memory_environment(['demo']);

    await environment.exec?.({
      command: 'touch',
      args: ['notes/b.md'],
      cwd: '/memory/demo',
      writable_paths: ['/memory/demo/notes'],
    });

    expect(fake_sandbox.commands_run).toEqual(["'touch' 'notes/b.md'"]);
    expect(archil_commands()).toEqual([]);
  });

  it('refuses a closed scope before any sandbox call, with the escape message', async () => {
    const environment = await connect_memory_environment(['demo']);
    const refusals = [
      () => environment.write?.('/memory/secret/a.md', 'x'),
      () => environment.exec?.({ command: 'true', writable_paths: ['/memory/secret'] }),
      () => environment.exec?.({ command: 'true', cwd: '/memory/secret' }),
      () => environment.glob?.({ pattern: '/memory/secret/*.md' }),
      () => environment.list?.({ path: '/memory' }),
    ];

    for (const refusal of refusals) {
      await expect(refusal()).rejects.toThrow(/^Path escapes workspace: \/memory/u);
    }
    expect(fake_sandbox.files_written).toEqual([]);
    expect(fake_sandbox.commands_run).toEqual([]);
  });

  it('opens nothing for a sandbox connected without a slug set', async () => {
    const environment = await connect_memory_environment([]);

    await expect(environment.write?.('/memory/demo/a.md', 'x')).rejects.toThrow(
      'Path escapes workspace: /memory/demo/a.md',
    );
    expect(fake_sandbox.files_written).toEqual([]);
  });
});

describe('listing and searching an open /memory folder through E2B', () => {
  it('lists an open scope folder with model paths under /memory, not /workspace', async () => {
    const environment = await connect_memory_environment(['demo']);
    fake_sandbox.list_result = [{ name: 'a.md', path: '/memory/demo/notes/a.md', type: 'file' }];

    const entries = await environment.list?.({ path: '/memory/demo/notes' });

    expect(entries).toEqual([{ path: '/memory/demo/notes/a.md', name: 'a.md', kind: 'file' }]);
  });

  it('greps an open scope folder with model paths under /memory, not /workspace', async () => {
    const environment = await connect_memory_environment(['demo']);
    fake_sandbox.grep_stdout = '/memory/demo/notes/a.md:1:beta\n';

    const matches = await environment.grep?.({ pattern: 'beta', path: '/memory/demo' });

    expect(matches).toEqual([{ path: '/memory/demo/notes/a.md', line: 1, text: 'beta' }]);
  });
});

describe('split_writable_paths', () => {
  it('keeps volume paths for ownership, open memory paths aside, and drops the rest', async () => {
    const { split_writable_paths } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_paths'
    );

    expect(
      split_writable_paths(
        ['people/ada.md', '/workspace/files', '/memory/demo/notes', '/tmp/scratch'],
        new Set(['demo']),
      ),
    ).toEqual({
      volume_paths: ['/workspace/people/ada.md', '/workspace/files'],
      memory_root_paths: ['/memory/demo/notes'],
      ignored_paths: ['/tmp/scratch'],
    });
    expect(() => split_writable_paths(['/memory/secret'], new Set(['demo']))).toThrow(
      /^Path escapes workspace: \/memory\/secret/u,
    );
  });
});

describe('sandbox_scratch_script', () => {
  it('creates the memory root on sandbox-local disk for the runtime user', async () => {
    const { sandbox_scratch_script } = await import(
      '@runtime-platform/orchestrator/e2b_volume_scripts'
    );
    const { memory_root_model_path } = await import('@runtime-platform/storage/memory_root');

    const script = sandbox_scratch_script('1000:1000');

    expect(script).toContain(`mkdir -p -- /tmp/coworker ${memory_root_model_path}`);
    expect(script).toContain(`chown -h '1000:1000' -- /tmp/coworker ${memory_root_model_path}`);
  });
});
