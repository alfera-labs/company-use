import { count_database_connections } from '@coworker/core/db/__tests__/counted_database';
import { get_database } from '@coworker/core/db/connection';
import { path_is_on_workspace_volume } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import { run_with_e2b_write_ownership } from '@runtime-platform/orchestrator/e2b_write_ownership';
import type { OpenVolume } from '@runtime-platform/storage/volume_runtime';
import { CommandExitError, FileNotFoundError } from 'e2b';
import { describe, expect, it, vi } from 'vitest';

const database_url = process.env.DATABASE_URL;

if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error('COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not');
}

const volume: OpenVolume = {
  volume_id: 'vol_write_test',
  workspace_mount_key: 'workspace:ws_test:ses_test',
  provider: 'archil',
  workspace_layout_version: 2,
  provider_volume_id: 'dsk_write_test',
  provider_region: 'aws-us-west-2',
  root_path: '/mnt/coworker',
  mount_token: 'test-token',
};

type OwnershipSandbox = Parameters<typeof run_with_e2b_write_ownership>[0];

function create_fake_sandbox(
  path_exists: (file_path: string) => boolean = () => true,
  command_fails: (command: string) => boolean = () => false,
  exit_code_for: (command: string) => number = (command) => (command_fails(command) ? 1 : 0),
  sandbox_id = 'sandbox_write_test',
) {
  const commands_run: string[] = [];
  const sandbox = {
    sandboxId: sandbox_id,
    files: {
      getInfo: vi.fn(async (file_path: string) => {
        if (!path_exists(file_path)) throw new FileNotFoundError(`Missing ${file_path}`, '');
        return {};
      }),
    },
    commands: {
      run: vi.fn(async (command: string) => {
        commands_run.push(command);
        const exit_code = exit_code_for(command);
        const result = {
          exitCode: exit_code,
          stdout: '',
          stderr: exit_code === 0 ? '' : 'permission denied',
          error: undefined,
        };
        if (result.exitCode !== 0) throw new CommandExitError(result as never);
        return result;
      }),
    },
  } as unknown as OwnershipSandbox;
  return { sandbox, commands_run };
}

const checkout_commands = (commands: string[]) =>
  commands.filter((command) => command.startsWith("'archil' 'checkout'"));
const checkin_commands = (commands: string[]) =>
  commands.filter((command) => command.startsWith("'archil' 'checkin'"));
const lease_action = (command: string) =>
  command.startsWith("'sh' '-c'") ? (command.match(/'(claim|release)'$/u)?.[1] ?? null) : null;
const write_steps = (commands: string[]) =>
  commands.flatMap((command) => {
    const action = lease_action(command);
    if (action) return [action];
    if (command.startsWith("'archil' 'checkout'")) return ['checkout'];
    if (command.startsWith("'archil' 'checkin'")) return ['checkin'];
    return [];
  });

const agent_workspace = 'agents/ag_test/workspace';

describe('run_with_e2b_write_ownership', () => {
  it('claims and releases an existing persistent file around its mutation', async () => {
    const { sandbox, commands_run } = create_fake_sandbox();
    const mutation = vi.fn(async () => 'written');

    await expect(
      run_with_e2b_write_ownership(
        sandbox,
        volume,
        agent_workspace,
        ['/workspace/repo/report.xlsx'],
        mutation,
      ),
    ).resolves.toBe('written');

    expect(mutation).toHaveBeenCalledOnce();
    expect(checkout_commands(commands_run)).toEqual([
      "'archil' 'checkout' '/mnt/coworker/agents/ag_test/workspace/repo/report.xlsx'",
    ]);
    expect(checkin_commands(commands_run)).toEqual([
      "'archil' 'checkin' '/mnt/coworker/agents/ag_test/workspace/repo/report.xlsx'",
    ]);
  });

  it('releases an existing file when its mutation fails', async () => {
    const { sandbox, commands_run } = create_fake_sandbox();
    const mutation_error = new Error('write failed');

    await expect(
      run_with_e2b_write_ownership(
        sandbox,
        volume,
        agent_workspace,
        ['/workspace/repo/report.xlsx'],
        async () => {
          throw mutation_error;
        },
      ),
    ).rejects.toBe(mutation_error);

    expect(checkin_commands(commands_run)).toHaveLength(1);
  });

  it('names both the failed write and the failed release instead of a bare failure', async () => {
    const { sandbox } = create_fake_sandbox(
      () => true,
      (command) => command.startsWith("'archil' 'checkin'"),
    );

    const failure = await run_with_e2b_write_ownership(
      sandbox,
      volume,
      agent_workspace,
      ['/workspace/daily-logs/2026-09-30.md'],
      async () => {
        throw new Error('open /workspace/daily-logs/2026-09-30.md: read-only file system');
      },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as Error).message).toContain('read-only file system');
    expect((failure as Error).message).toContain('Archil checkin of');
  });

  it('leaves new paths to Archil dynamic ownership', async () => {
    const { sandbox, commands_run } = create_fake_sandbox(() => false);

    await run_with_e2b_write_ownership(
      sandbox,
      volume,
      agent_workspace,
      ['/workspace/repo/outputs/report.xlsx'],
      async () => undefined,
    );

    expect(write_steps(commands_run)).toEqual(['claim', 'release']);
  });

  it('does not claim a parent and its nested child separately', async () => {
    const { sandbox, commands_run } = create_fake_sandbox();

    await run_with_e2b_write_ownership(
      sandbox,
      volume,
      agent_workspace,
      ['/workspace/repo/outputs', '/workspace/repo/outputs/report.xlsx'],
      async () => undefined,
    );

    expect(checkout_commands(commands_run)).toEqual([
      "'archil' 'checkout' '/mnt/coworker/agents/ag_test/workspace/repo/outputs'",
    ]);
    expect(checkin_commands(commands_run)).toEqual([
      "'archil' 'checkin' '/mnt/coworker/agents/ag_test/workspace/repo/outputs'",
    ]);
  });

  it('releases earlier claims when a later checkout fails', async () => {
    const { sandbox, commands_run } = create_fake_sandbox(
      () => true,
      (command) => command.includes('/repo/b.txt'),
    );

    await expect(
      run_with_e2b_write_ownership(
        sandbox,
        volume,
        agent_workspace,
        ['/workspace/repo/b.txt', '/workspace/repo/a.txt'],
        async () => undefined,
      ),
    ).rejects.toThrow(/permission denied/u);

    expect(checkout_commands(commands_run)).toEqual([
      "'archil' 'checkout' '/mnt/coworker/agents/ag_test/workspace/repo/a.txt'",
      "'archil' 'checkout' '/mnt/coworker/agents/ag_test/workspace/repo/b.txt'",
    ]);
    expect(checkin_commands(commands_run)).toEqual([
      "'archil' 'checkin' '/mnt/coworker/agents/ag_test/workspace/repo/a.txt'",
    ]);
  });

  it('runs durable writes in one sandbox one at a time, each inside a claimed lease', async () => {
    const { sandbox, commands_run } = create_fake_sandbox();
    let running = 0;
    let most_running = 0;
    const slow_write = () =>
      run_with_e2b_write_ownership(
        sandbox,
        volume,
        agent_workspace,
        ['/workspace/repo/report.xlsx'],
        async () => {
          running += 1;
          most_running = Math.max(most_running, running);
          await new Promise((resolve) => setTimeout(resolve, 20));
          running -= 1;
        },
      );

    await Promise.all([slow_write(), slow_write(), slow_write()]);

    expect(most_running).toBe(1);
    expect(write_steps(commands_run)).toEqual(
      Array.from({ length: 3 }, () => ['claim', 'checkout', 'checkin', 'release']).flat(),
    );
  });

  it('waits while a writer in another process holds the sandbox lease', async () => {
    let refused_claims = 2;
    const { sandbox, commands_run } = create_fake_sandbox(
      () => true,
      () => false,
      (command) => {
        if (lease_action(command) !== 'claim' || refused_claims === 0) return 0;
        refused_claims -= 1;
        return 75;
      },
    );

    await expect(
      run_with_e2b_write_ownership(
        sandbox,
        volume,
        agent_workspace,
        ['/workspace/repo/report.xlsx'],
        async () => 'written',
      ),
    ).resolves.toBe('written');

    expect(write_steps(commands_run)).toEqual([
      'claim',
      'claim',
      'claim',
      'checkout',
      'checkin',
      'release',
    ]);
  });

  it('stops before any write when the lease cannot be claimed at all', async () => {
    const { sandbox, commands_run } = create_fake_sandbox(
      () => true,
      () => false,
      (command) => (lease_action(command) === 'claim' ? 127 : 0),
    );
    const mutation = vi.fn(async () => undefined);

    await expect(
      run_with_e2b_write_ownership(
        sandbox,
        volume,
        agent_workspace,
        ['/workspace/repo/report.xlsx'],
        mutation,
      ),
    ).rejects.toThrow(/Claiming the sandbox write lease failed/u);

    expect(mutation).not.toHaveBeenCalled();
    expect(write_steps(commands_run)).toEqual(['claim']);
  });

  it('runs scratch mutations without touching Archil ownership', async () => {
    const { sandbox, commands_run } = create_fake_sandbox();

    await run_with_e2b_write_ownership(
      sandbox,
      volume,
      agent_workspace,
      ['/workspace/tmp/report.xlsx'],
      async () => undefined,
    );

    expect(commands_run).toHaveLength(0);
  });
});

describe.skipIf(!database_url)(
  'pooled connections a durable E2B write holds (needs real Postgres)',
  () => {
    it('holds no pooled connection while sandbox writes run', async () => {
      const pool_connections = count_database_connections(get_database());
      const writes = ['sandbox_a', 'sandbox_a', 'sandbox_b', 'sandbox_c', 'sandbox_d'].map(
        (sandbox_id) =>
          run_with_e2b_write_ownership(
            create_fake_sandbox(undefined, undefined, undefined, sandbox_id).sandbox,
            volume,
            agent_workspace,
            ['/workspace/repo/report.xlsx'],
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 200));
              return pool_connections.in_use();
            },
          ),
      );

      const in_use_during_writes = await Promise.all(writes);

      expect(in_use_during_writes).toEqual([0, 0, 0, 0, 0]);
      expect(pool_connections.most_in_use()).toBe(0);
    });
  },
);

describe('path_is_on_workspace_volume', () => {
  it('accepts the workspace volume and anything under it, including relative paths', () => {
    for (const workspace_path of [
      '/workspace',
      '/workspace/people',
      '/workspace/files/out.csv',
      'files/out',
    ]) {
      expect(path_is_on_workspace_volume(workspace_path)).toBe(true);
    }
  });

  it('rejects absolute paths off the volume, including ones that climb out of it', () => {
    for (const off_volume_path of [
      '/tmp',
      '/tmp/bench',
      '/etc/passwd',
      '/workspace/../tmp',
      '/workshop',
    ]) {
      expect(path_is_on_workspace_volume(off_volume_path)).toBe(false);
    }
  });
});
