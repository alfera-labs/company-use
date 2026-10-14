import type { SessionEnvExecInput } from '@agent-core/environment';
import {
  find_workspace_tool,
  workspace_tool_timeout_ms,
} from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it, vi } from 'vitest';

function run_command_tool() {
  const tool = find_workspace_tool('workspace-run_command');
  if (!tool) throw new Error('workspace-run_command is not registered.');
  return tool;
}

describe('workspace-run_command', () => {
  it('passes declared writable paths to the workspace environment', async () => {
    const exec = vi.fn(async () => ({ exit_code: 0, stdout: 'done', stderr: '' }));

    const result = await run_command_tool().execute(
      {
        command: 'python3',
        args: ['/workspace/tmp/build.py'],
        cwd: '/workspace/files',
        writable_paths: ['/workspace/files/outputs'],
      },
      { environment: { exec } } as never,
    );

    expect(result).toMatchObject({ ok: true });
    expect(exec).toHaveBeenCalledWith({
      command: 'python3',
      args: ['/workspace/tmp/build.py'],
      cwd: 'files',
      writable_paths: ['/workspace/files/outputs'],
      timeout_ms: 120_000,
    } satisfies SessionEnvExecInput);
  });

  it('honours a requested timeout up to ten minutes and clamps anything above it', async () => {
    const exec = vi.fn(async (_input: SessionEnvExecInput) => ({
      exit_code: 0,
      stdout: '',
      stderr: '',
    }));
    const tool = run_command_tool();

    await tool.execute({ command: 'npm', args: ['install'], timeout_ms: 600_000 }, {
      environment: { exec },
    } as never);
    await tool.execute({ command: 'npm', args: ['install'], timeout_ms: 3_600_000 }, {
      environment: { exec },
    } as never);

    expect(exec.mock.calls.map(([input]) => input.timeout_ms)).toEqual([600_000, 600_000]);
  });

  it('gives the policy race more time than the timeout the provider was asked for', () => {
    const tool = run_command_tool();

    expect(workspace_tool_timeout_ms(tool, {})).toBeGreaterThan(120_000);
    expect(workspace_tool_timeout_ms(tool, { timeout_ms: 600_000 })).toBeGreaterThan(600_000);
    expect(workspace_tool_timeout_ms(tool, { timeout_ms: 3_600_000 })).toBeLessThanOrEqual(610_000);
  });

  it('answers a timeout with both remedies and the partial output', async () => {
    const exec = vi.fn(async () => ({
      exit_code: 124,
      stdout: 'added 240 packages',
      stderr: '',
      timed_out: true,
    }));

    const result = await run_command_tool().execute(
      { command: 'npm', args: ['install'], timeout_ms: 120_000 },
      { environment: { exec } } as never,
    );

    expect(result).toMatchObject({ ok: false, error_code: 'timed_out' });
    if (result.ok) throw new Error('Expected the command to time out.');
    expect(result.error_message).toContain('added 240 packages');
    expect(result.error_message).toMatch(/ran for \d+s and was stopped at its 120s timeout/u);
    expect(result.error_message).toContain('timeout_ms');
    expect(result.error_message).toContain('600000');
    expect(result.error_message).toContain('workspace-start_background_command');
  });

  it('refuses a process that stays up and names both places it can go instead', async () => {
    const exec = vi.fn(async () => ({ exit_code: 0, stdout: '', stderr: '' }));

    const result = await run_command_tool().execute(
      { command: 'sh', args: ['-c', 'npm start &'] },
      { environment: { exec } } as never,
    );

    expect(result).toMatchObject({ ok: false, error_code: 'blocked_by_policy' });
    if (result.ok) throw new Error('Expected the background process to be refused.');
    expect(result.error_message).toContain('workspace-preview');
    expect(result.error_message).toContain('workspace-start_background_command');
    expect(exec).not.toHaveBeenCalled();
  });
});
