import { env } from '@coworker/config';
import {
  background_command_output_limit_bytes,
  e2b_background_command_status,
  find_e2b_background_command,
  forget_e2b_background_commands,
  list_e2b_background_commands,
  preview_background_command_id,
  preview_output_limit_bytes,
  start_e2b_background_command,
  stop_e2b_background_command,
  stop_e2b_background_commands,
  wait_for_e2b_background_command_exit,
} from '@runtime-platform/orchestrator/e2b_background_commands';
import { afterEach, describe, expect, it, vi } from 'vitest';

type FakeCommand = {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  wait: () => Promise<{ exitCode: number }>;
  emit_stdout: (data: string) => void;
  emit_stderr: (data: string) => void;
  exit: (exit_code: number) => void;
};

function create_fake_sandbox(sandbox_id: string) {
  const started_commands: {
    command: string;
    cwd: string;
    background?: boolean;
    timeout_ms: number | undefined;
  }[] = [];
  const shell_commands: string[] = [];
  const commands = new Map<number, FakeCommand>();
  let next_pid = 100;

  const run = vi.fn(
    async (
      command: string,
      options: {
        cwd?: string;
        background?: boolean;
        timeoutMs?: number;
        onStdout?: (data: string) => void;
        onStderr?: (data: string) => void;
      } = {},
    ) => {
      if (!options.background) {
        shell_commands.push(command);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      started_commands.push({
        command,
        cwd: options.cwd ?? '',
        background: true,
        timeout_ms: options.timeoutMs,
      });
      next_pid += 1;
      const pid = next_pid;
      let settle: (exit_code: number) => void = () => undefined;
      const exit_promise = new Promise<{ exitCode: number }>((resolve) => {
        settle = (exit_code: number) => resolve({ exitCode: exit_code });
      });
      const fake_command: FakeCommand = {
        pid,
        kill: vi.fn(async () => true),
        wait: () => exit_promise,
        emit_stdout: (data) => options.onStdout?.(data),
        emit_stderr: (data) => options.onStderr?.(data),
        exit: (exit_code) => settle(exit_code),
      };
      commands.set(pid, fake_command);
      return fake_command;
    },
  );

  return {
    sandbox: { sandboxId: sandbox_id, commands: { run } } as never,
    started_commands,
    shell_commands,
    command_by_pid: commands,
  };
}

const started_sandbox_ids: string[] = [];

function fake_sandbox(sandbox_id: string) {
  started_sandbox_ids.push(sandbox_id);
  return create_fake_sandbox(sandbox_id);
}

afterEach(() => {
  for (const sandbox_id of started_sandbox_ids.splice(0)) {
    forget_e2b_background_commands(sandbox_id);
  }
});

describe('e2b background commands', () => {
  it('reports running, then the collected exit code, for the same job id', async () => {
    const { sandbox, command_by_pid, started_commands } = fake_sandbox('sbx_status');
    const job = await start_e2b_background_command(sandbox, {
      command: 'npm install',
      cwd: '/work/repo',
    });

    expect(started_commands[0]?.timeout_ms).toBe(env.COWORKER_E2B_TIMEOUT_MS);
    expect(e2b_background_command_status(job)).toMatchObject({
      status: 'running',
      command: 'npm install',
      cwd: '/work/repo',
    });
    expect(e2b_background_command_status(job).exit_code).toBeUndefined();

    command_by_pid.get(job.handle.pid)?.exit(0);
    await job.exit;

    expect(e2b_background_command_status(job)).toMatchObject({ status: 'exited', exit_code: 0 });
    expect(find_e2b_background_command('sbx_status', job.background_command_id)).toBe(job);
  });

  it('keeps only the tail of a noisy job, at the background limit', async () => {
    const { sandbox, command_by_pid } = fake_sandbox('sbx_rollover');
    const job = await start_e2b_background_command(sandbox, {
      command: 'npm install',
      cwd: '/work/repo',
    });
    const fake_command = command_by_pid.get(job.handle.pid);

    fake_command?.emit_stdout('x'.repeat(background_command_output_limit_bytes));
    fake_command?.emit_stdout('LAST-LINE');

    const status = e2b_background_command_status(job);
    expect(status.stdout).toHaveLength(background_command_output_limit_bytes);
    expect(status.stdout.endsWith('LAST-LINE')).toBe(true);
  });

  it('keeps previews on their smaller tail and off the background command list', async () => {
    const { sandbox, command_by_pid, started_commands } = fake_sandbox('sbx_preview');
    const preview = await start_e2b_background_command(sandbox, {
      command: 'npm run dev',
      cwd: '/work/repo',
      kind: 'preview',
      background_command_id: preview_background_command_id(3000),
      output_limit_bytes: preview_output_limit_bytes,
    });

    command_by_pid.get(preview.handle.pid)?.emit_stderr('y'.repeat(10_000));

    expect(started_commands[0]?.timeout_ms).toBe(0);
    expect(preview.output.stderr).toHaveLength(preview_output_limit_bytes);
    expect(list_e2b_background_commands('sbx_preview')).toEqual([]);
    expect(list_e2b_background_commands('sbx_preview', 'preview')).toEqual([preview]);
    expect(find_e2b_background_command('sbx_preview', 'preview-3000')).toBe(preview);
  });

  it('returns from a wait as soon as the job exits, and at the deadline otherwise', async () => {
    const { sandbox, command_by_pid } = fake_sandbox('sbx_wait');
    const job = await start_e2b_background_command(sandbox, {
      command: 'sleep 30',
      cwd: '/work/repo',
    });

    const before_deadline = Date.now();
    await wait_for_e2b_background_command_exit(job, 50);
    expect(Date.now() - before_deadline).toBeGreaterThanOrEqual(45);
    expect(e2b_background_command_status(job).status).toBe('running');

    const before_exit = Date.now();
    setTimeout(() => command_by_pid.get(job.handle.pid)?.exit(3), 20);
    await wait_for_e2b_background_command_exit(job, 5_000);
    expect(Date.now() - before_exit).toBeLessThan(1_000);
    expect(e2b_background_command_status(job)).toMatchObject({ status: 'exited', exit_code: 3 });
  });

  it('kills the job and its whole process tree, and forgets it', async () => {
    const { sandbox, shell_commands, command_by_pid } = fake_sandbox('sbx_stop');
    const job = await start_e2b_background_command(sandbox, {
      command: 'npm run watch',
      cwd: '/work/repo',
    });

    await stop_e2b_background_command(sandbox, job);

    expect(command_by_pid.get(job.handle.pid)?.kill).toHaveBeenCalledOnce();
    expect(
      shell_commands.some(
        (command) => command.includes(`root=${job.handle.pid}`) && command.includes('kill -9'),
      ),
    ).toBe(true);
    expect(find_e2b_background_command('sbx_stop', job.background_command_id)).toBeUndefined();
    expect(list_e2b_background_commands('sbx_stop')).toEqual([]);
  });

  it('stops every process of one sandbox and leaves other sandboxes alone', async () => {
    const stopped = fake_sandbox('sbx_teardown');
    const other = fake_sandbox('sbx_other');
    const job = await start_e2b_background_command(stopped.sandbox, {
      command: 'npm install',
      cwd: '/work/repo',
    });
    const preview = await start_e2b_background_command(stopped.sandbox, {
      command: 'npm run dev',
      cwd: '/work/repo',
      kind: 'preview',
      background_command_id: preview_background_command_id(3000),
    });
    const survivor = await start_e2b_background_command(other.sandbox, {
      command: 'npm install',
      cwd: '/work/repo',
    });

    await stop_e2b_background_commands(stopped.sandbox);

    expect(stopped.command_by_pid.get(job.handle.pid)?.kill).toHaveBeenCalledOnce();
    expect(stopped.command_by_pid.get(preview.handle.pid)?.kill).toHaveBeenCalledOnce();
    expect(list_e2b_background_commands('sbx_teardown', 'preview')).toEqual([]);
    expect(other.command_by_pid.get(survivor.handle.pid)?.kill).not.toHaveBeenCalled();
    expect(find_e2b_background_command('sbx_other', survivor.background_command_id)).toBe(survivor);
  });
});
