import type { SessionEnvBackgroundCommandStatus } from '@agent-core/environment';
import {
  find_workspace_tool,
  workspace_tool_timeout_ms,
} from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it, vi } from 'vitest';

function background_tool(tool_name: string) {
  const tool = find_workspace_tool(tool_name);
  if (!tool) throw new Error(`${tool_name} is not registered.`);
  return tool;
}

function running_command(background_command_id: string): SessionEnvBackgroundCommandStatus {
  return {
    background_command_id,
    status: 'running',
    command: 'npm install',
    cwd: 'repo',
    started_time: '2026-08-05T10:00:00.000Z',
    stdout: '',
    stderr: '',
  };
}

function create_background_environment(initial: SessionEnvBackgroundCommandStatus[] = []) {
  const commands = new Map(initial.map((status) => [status.background_command_id, status]));
  const start_background_command = vi.fn(
    async (input: { command: string; args?: string[]; cwd?: string }) => {
      const status: SessionEnvBackgroundCommandStatus = {
        background_command_id: `bg_${commands.size + 1}`,
        status: 'running',
        command: [input.command, ...(input.args ?? [])].join(' '),
        cwd: input.cwd ?? 'repo',
        started_time: '2026-08-05T10:00:00.000Z',
        stdout: '',
        stderr: '',
      };
      commands.set(status.background_command_id, status);
      return status;
    },
  );
  const check_background_command = vi.fn(
    async (input: { background_command_id: string; wait_seconds?: number }) =>
      commands.get(input.background_command_id) ?? null,
  );
  const stop_background_command = vi.fn(async (input: { background_command_id: string }) => {
    const status = commands.get(input.background_command_id);
    if (!status) return null;
    commands.delete(input.background_command_id);
    return { ...status, status: 'exited' as const, exit_code: 137 };
  });
  const list_background_commands = vi.fn(async () => [...commands.values()]);

  return {
    environment: {
      start_background_command,
      check_background_command,
      stop_background_command,
      list_background_commands,
    },
    start_background_command,
    check_background_command,
    stop_background_command,
  };
}

describe('workspace background commands', () => {
  it('starts a job under the same path rule as every other workspace tool', async () => {
    const sandbox = create_background_environment();

    const result = await background_tool('workspace-start_background_command').execute(
      { command: 'npm', args: ['install'], cwd: 'weather-app' },
      { environment: sandbox.environment } as never,
    );

    expect(result).toMatchObject({ ok: true });
    expect(sandbox.start_background_command).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npm', args: ['install'], cwd: 'weather-app' }),
    );
    if (!result.ok) throw new Error('Expected the background command to start.');
    expect(result.content_json).toMatchObject({
      background_command_id: 'bg_1',
      status: 'running',
      command: 'npm install',
    });
  });

  it('refuses a sixth concurrent job and names the ones already running', async () => {
    const sandbox = create_background_environment(
      ['bg_1', 'bg_2', 'bg_3', 'bg_4', 'bg_5'].map(running_command),
    );

    const result = await background_tool('workspace-start_background_command').execute(
      { command: 'npm', args: ['install'] },
      { environment: sandbox.environment } as never,
    );

    expect(result).toMatchObject({ ok: false, error_code: 'too_many_background_commands' });
    if (result.ok) throw new Error('Expected the sixth background command to be refused.');
    expect(result.error_message).toContain('bg_3');
    expect(result.error_message).toContain('workspace-stop_background_command');
    expect(sandbox.start_background_command).not.toHaveBeenCalled();
  });

  it('counts only running jobs against the limit', async () => {
    const sandbox = create_background_environment([
      ...['bg_1', 'bg_2', 'bg_3', 'bg_4'].map(running_command),
      { ...running_command('bg_5'), status: 'exited' as const, exit_code: 0 },
    ]);

    const result = await background_tool('workspace-start_background_command').execute(
      { command: 'npm', args: ['install'] },
      { environment: sandbox.environment } as never,
    );

    expect(result).toMatchObject({ ok: true });
  });

  it('reports the exit code and output tail of a finished job', async () => {
    const sandbox = create_background_environment([
      {
        ...running_command('bg_1'),
        status: 'exited',
        exit_code: 1,
        stdout: 'added 240 packages',
        stderr: 'npm ERR! code ELIFECYCLE',
      },
    ]);

    const result = await background_tool('workspace-check_background_command').execute(
      { background_command_id: 'bg_1', wait_seconds: 120 },
      { environment: sandbox.environment } as never,
    );

    expect(sandbox.check_background_command).toHaveBeenCalledWith({
      background_command_id: 'bg_1',
      wait_seconds: 120,
    });
    if (!result.ok) throw new Error('Expected the check to succeed.');
    expect(result.content_json).toMatchObject({
      status: 'exited',
      exit_code: 1,
      stdout: 'added 240 packages',
      stderr: 'npm ERR! code ELIFECYCLE',
    });
  });

  it('caps wait_seconds at two minutes instead of parking forever', async () => {
    const sandbox = create_background_environment([running_command('bg_1')]);

    await background_tool('workspace-check_background_command').execute(
      { background_command_id: 'bg_1', wait_seconds: 3_600 },
      { environment: sandbox.environment } as never,
    );

    expect(sandbox.check_background_command).toHaveBeenCalledWith({
      background_command_id: 'bg_1',
      wait_seconds: 120,
    });
  });

  it('gives the policy race room for the whole wait', () => {
    const tool = background_tool('workspace-check_background_command');

    expect(workspace_tool_timeout_ms(tool, { background_command_id: 'bg_1' })).toBe(120_000);
    expect(
      workspace_tool_timeout_ms(tool, { background_command_id: 'bg_1', wait_seconds: 120 }),
    ).toBeGreaterThan(120_000 + 120_000 - 1);
  });

  it('stops a job and reports it as stopped', async () => {
    const sandbox = create_background_environment([running_command('bg_1')]);

    const result = await background_tool('workspace-stop_background_command').execute(
      { background_command_id: 'bg_1' },
      { environment: sandbox.environment } as never,
    );

    expect(sandbox.stop_background_command).toHaveBeenCalledWith({
      background_command_id: 'bg_1',
    });
    if (!result.ok) throw new Error('Expected the stop to succeed.');
    expect(result.content_json).toMatchObject({ background_command_id: 'bg_1', status: 'stopped' });
  });

  it('explains an unknown id instead of failing bare', async () => {
    const sandbox = create_background_environment();

    const result = await background_tool('workspace-check_background_command').execute(
      { background_command_id: 'bg_gone' },
      { environment: sandbox.environment } as never,
    );

    expect(result).toMatchObject({ ok: false, error_code: 'background_command_not_found' });
    if (result.ok) throw new Error('Expected the unknown id to be reported.');
    expect(result.error_message).toContain('sandbox');
  });

  it('says background commands are unsupported on a provider that has no such seam', async () => {
    const result = await background_tool('workspace-start_background_command').execute(
      { command: 'npm', args: ['install'] },
      { environment: { exec: vi.fn() } } as never,
    );

    expect(result).toMatchObject({ ok: false, error_code: 'background_commands_unsupported' });
    if (result.ok) throw new Error('Expected background commands to be unsupported.');
    expect(result.error_message).toContain('workspace-run_command');
  });
});
