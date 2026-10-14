import type { SessionEnvExecInput, SessionEnvGlobInput } from '@agent-core/environment';
import { find_workspace_tool } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it, vi } from 'vitest';

function create_recording_environment() {
  return {
    exec: vi.fn(async (_input: SessionEnvExecInput) => ({
      exit_code: 0,
      stdout: '',
      stderr: '',
    })),
    write: vi.fn(async () => undefined),
    read: vi.fn(async () => 'contents'),
    list: vi.fn(async () => []),
    grep: vi.fn(async () => []),
    glob: vi.fn(async (_input: SessionEnvGlobInput) => [] as string[]),
    start_preview: vi.fn(async () => ({
      port: 3000,
      command: 'npm run dev',
      cwd: 'repo',
      provider_host: 'localhost',
    })),
    start_background_command: vi.fn(async (input: { cwd?: string }) => ({
      background_command_id: 'bg_1',
      status: 'running' as const,
      command: 'npm install',
      cwd: input.cwd ?? 'repo',
      started_time: '2026-08-05T10:00:00.000Z',
      stdout: '',
      stderr: '',
    })),
    list_background_commands: vi.fn(async () => []),
  };
}

function workspace_tool(tool_name: string) {
  const tool = find_workspace_tool(tool_name);
  if (!tool) throw new Error(`${tool_name} is not registered.`);
  return tool;
}

function parse_tool_input(tool_name: string, input: unknown) {
  const schema = workspace_tool(tool_name).validate_input;
  if (!schema) throw new Error(`${tool_name} has no input schema.`);
  return schema.safeParse(input);
}

async function run_tool(tool_name: string, input: unknown, environment: unknown) {
  return workspace_tool(tool_name).execute(input as never, { environment } as never);
}

describe('workspace path resolution', () => {
  it('resolves a plain relative path to the same place in write, list, grep and glob', async () => {
    const environment = create_recording_environment();

    await run_tool('workspace-write_file', { path: 'notes.md', content: 'hi' }, environment);
    await run_tool('workspace-read_file', { path: 'notes.md' }, environment);
    await run_tool('workspace-list_files', { path: 'notes.md' }, environment);
    await run_tool('workspace-grep', { pattern: 'hi', path: 'notes.md' }, environment);
    await run_tool('workspace-glob', { pattern: 'notes.md' }, environment);

    expect(environment.write).toHaveBeenCalledWith('notes.md', 'hi');
    expect(environment.read).toHaveBeenCalledWith('notes.md');
    expect(environment.list).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes.md' }));
    expect(environment.grep).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes.md' }));
    expect(environment.glob).toHaveBeenCalledWith(expect.objectContaining({ pattern: 'notes.md' }));
  });

  it('refuses a path that climbs out of the workspace', async () => {
    const environment = create_recording_environment();

    await expect(
      run_tool('workspace-read_file', { path: '../tmp/attachments/att_1/deck.pdf' }, environment),
    ).rejects.toThrow(/Path escapes workspace/u);
    expect(environment.read).not.toHaveBeenCalled();
  });

  it('still refuses a path that climbs above the workspace after resolving', async () => {
    const environment = create_recording_environment();

    await expect(
      run_tool('workspace-read_file', { path: '../../etc/passwd' }, environment),
    ).rejects.toThrow(/Path escapes workspace/u);
    expect(environment.read).not.toHaveBeenCalled();
  });

  it('keeps "." meaning the workspace root for list and grep', async () => {
    const environment = create_recording_environment();

    await run_tool('workspace-list_files', {}, environment);
    await run_tool('workspace-grep', { pattern: 'hi' }, environment);

    expect(environment.list).toHaveBeenCalledWith(expect.objectContaining({ path: '.' }));
    expect(environment.grep).toHaveBeenCalledWith(expect.objectContaining({ path: '.' }));
  });

  it('treats an empty path as the workspace root for list', async () => {
    const environment = create_recording_environment();

    await run_tool('workspace-list_files', { path: '' }, environment);

    expect(environment.list).toHaveBeenCalledWith(expect.objectContaining({ path: '.' }));
  });

  it('accepts an empty path as the workspace root for grep', async () => {
    const environment = create_recording_environment();
    const parsed = parse_tool_input('workspace-grep', { pattern: 'vendor', path: '' });
    expect(parsed.success).toBe(true);
    await run_tool('workspace-grep', parsed.data, environment);

    expect(environment.grep).toHaveBeenCalledWith(expect.objectContaining({ path: '.' }));
  });

  it('leaves a wildcard-rooted glob searching the whole workspace', async () => {
    const environment = create_recording_environment();

    await run_tool('workspace-glob', { pattern: '**/*.png' }, environment);
    await run_tool('workspace-glob', { pattern: 'screenshots/*.png' }, environment);

    expect(environment.glob.mock.calls.map(([input]) => input.pattern)).toEqual([
      '**/*.png',
      'screenshots/*.png',
    ]);
  });

  it('resolves cwd by the same rule for run_command, background commands and preview', async () => {
    const environment = create_recording_environment();
    const cwd_cases = [
      { input: undefined, resolved: '.' },
      { input: '', resolved: '.' },
      { input: 'weather-app', resolved: 'weather-app' },
      { input: 'files', resolved: 'files' },
      { input: 'files/site', resolved: 'files/site' },
      { input: '/workspace', resolved: '.' },
      { input: '/workspace/files/site', resolved: 'files/site' },
    ];

    for (const cwd_case of cwd_cases) {
      const input = {
        command: 'ls',
        ...(cwd_case.input === undefined ? {} : { cwd: cwd_case.input }),
      };
      expect(parse_tool_input('workspace-run_command', input).success).toBe(true);
      await run_tool('workspace-run_command', input, environment);
    }
    for (const tool_name of ['workspace-start_background_command', 'workspace-preview']) {
      const input = { command: 'npm', cwd: '' };
      expect(parse_tool_input(tool_name, input).success).toBe(true);
    }
    await run_tool(
      'workspace-start_background_command',
      { command: 'npm', args: ['install'], cwd: 'weather-app' },
      environment,
    );
    await run_tool(
      'workspace-preview',
      { command: 'npm', args: ['run', 'dev'], cwd: 'weather-app' },
      environment,
    );

    expect(environment.exec.mock.calls.map(([input]) => input.cwd)).toEqual(
      cwd_cases.map((cwd_case) => cwd_case.resolved),
    );
    expect(environment.start_background_command).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: 'weather-app' }),
    );
    expect(environment.start_preview).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: 'weather-app' }),
    );
  });

  it('refuses paths that leave the workspace, wherever they are passed', async () => {
    const environment = create_recording_environment();

    const escaping_calls = [
      run_tool('workspace-list_files', { path: '../../escape' }, environment),
      run_tool('workspace-grep', { pattern: 'x', path: '/etc' }, environment),
      run_tool('workspace-glob', { pattern: '../../escape/*.md' }, environment),
      run_tool('workspace-write_file', { path: '/etc/passwd', content: 'x' }, environment),
      run_tool('workspace-read_file', { path: '/etc/passwd' }, environment),
    ];

    for (const escaping_call of escaping_calls) {
      await expect(escaping_call).rejects.toThrow(/Path escapes workspace/u);
    }
    expect(environment.list).not.toHaveBeenCalled();
    expect(environment.grep).not.toHaveBeenCalled();
    expect(environment.glob).not.toHaveBeenCalled();
    expect(environment.write).not.toHaveBeenCalled();
    expect(environment.read).not.toHaveBeenCalled();
  });

  it('starts a shell command from an absolute path outside the workspace', async () => {
    const environment = create_recording_environment();

    await run_tool('workspace-run_command', { command: 'ls', cwd: '/tmp/bench' }, environment);

    expect(environment.exec).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp/bench' }));
  });
});
