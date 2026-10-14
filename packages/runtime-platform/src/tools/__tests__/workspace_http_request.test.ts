import { find_workspace_tool } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it, vi } from 'vitest';

const tool_context = (exec: unknown) =>
  ({ environment: { exec }, tool_call_id: 'tcall_test_1' }) as never;

function curl_output(body: string, status: number, content_type: string) {
  return `${body}\n--coworker-http-tcall_test_1--\n${status}\n${content_type}`;
}

describe('workspace-http_request', () => {
  const tool = () => {
    const found = find_workspace_tool('workspace-http_request');
    if (!found) throw new Error('workspace-http_request is not registered.');
    return found;
  };

  it('runs curl inside the sandbox and returns the parsed response', async () => {
    const exec = vi.fn(async () => ({
      exit_code: 0,
      stdout: curl_output('{"login":{"id":628576}}', 200, 'application/json'),
      stderr: '',
    }));

    const result = await tool().execute(
      {
        method: 'get',
        url: 'https://www.acmebooking.com/api/current_login',
        headers: { Accept: 'application/json' },
      },
      tool_context(exec),
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected success');
    expect(result.content_text).toContain('HTTP 200 application/json');
    expect(result.content_text).toContain('{"login":{"id":628576}}');
    const exec_input = (exec.mock.calls as unknown[][])[0]?.[0] as {
      command: string;
      args: string[];
    };
    expect(exec_input.command).toBe('curl');
    expect(exec_input.args).toContain('https://www.acmebooking.com/api/current_login');
    expect(exec_input.args).toContain('-H');
    expect(exec_input.args).toContain('Accept: application/json');
  });

  it('refuses credential headers outright', async () => {
    const exec = vi.fn();
    const result = await tool().execute(
      {
        method: 'GET',
        url: 'https://api.example.com/v1/me',
        headers: { Authorization: 'Bearer sk-live-abc' },
      },
      tool_context(exec),
    );

    expect(result).toMatchObject({ ok: false, error_code: 'blocked_by_policy' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects non-http urls and unknown methods without executing', async () => {
    const exec = vi.fn();
    await expect(
      tool().execute({ method: 'GET', url: 'file:///etc/passwd' }, tool_context(exec)),
    ).resolves.toMatchObject({ ok: false, error_code: 'invalid_tool_input' });
    await expect(
      tool().execute({ method: 'TRACE', url: 'https://api.example.com' }, tool_context(exec)),
    ).resolves.toMatchObject({ ok: false, error_code: 'invalid_tool_input' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports transport failures with curl stderr', async () => {
    const exec = vi.fn(async () => ({
      exit_code: 6,
      stdout: '',
      stderr: 'curl: (6) Could not resolve host: nope.invalid',
    }));

    const result = await tool().execute(
      { method: 'GET', url: 'https://nope.invalid/x' },
      tool_context(exec),
    );

    expect(result).toMatchObject({ ok: false, error_code: 'http_request_failed' });
    if (result.ok) throw new Error('expected failure');
    expect(result.error_message).toContain('Could not resolve host');
  });
});
