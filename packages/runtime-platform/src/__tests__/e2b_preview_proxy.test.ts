import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const e2b_mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  create: vi.fn(),
  pause: vi.fn(),
  SandboxNotFoundError: class SandboxNotFoundError extends Error {},
}));

vi.mock('e2b', () => ({
  CommandExitError: class CommandExitError extends Error {},
  Sandbox: e2b_mocks,
  SandboxNotFoundError: e2b_mocks.SandboxNotFoundError,
  TimeoutError: class TimeoutError extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  e2b_mocks.connect.mockResolvedValue({
    getHost: () => '3210-test.e2b.app',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function persistent_test_volume() {
  return {
    volume_id: 'vol_1',
    workspace_mount_key: 'workspace:ws_1:ses_1',
    provider: 'archil' as const,
    workspace_layout_version: 2,
    provider_volume_id: 'dsk_1',
    provider_region: 'aws-us-east-1',
    root_path: '/mnt/coworker',
    mount_token: 'mount-token',
  };
}

describe('e2b preview proxy', () => {
  it('does not forward Coworker credentials to the sandbox or accept sandbox cookies back', async () => {
    const fetch_mock = vi.fn(async (_url: URL, _init?: RequestInit & { duplex?: 'half' }) => {
      return new Response('ok', {
        headers: {
          'clear-site-data': '"cookies"',
          'content-type': 'text/plain',
          'set-cookie': 'sandbox_session=bad',
        },
      });
    });
    vi.stubGlobal('fetch', fetch_mock);
    const { proxy_e2b_preview_request } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    const response = await proxy_e2b_preview_request({
      provider_sandbox_id: 'sbox_test',
      port: 3210,
      path: '/',
      search: '',
      request: new Request('http://coworker.test/preview', {
        headers: {
          authorization: 'Bearer secret',
          cookie: 'session=secret',
          referer: 'http://coworker.test/sessions/ses_1',
          'x-api-key': 'secret',
          'x-csrf-token': 'csrf-secret',
          'x-coworker-api-secret': 'proxy-secret',
          'x-coworker-auth-provider': 'workos',
          'x-coworker-auth-user-id': 'user_1',
          'x-coworker-preview-host': 'preview.test',
          'x-forwarded-port': '443',
          accept: 'text/html',
        },
      }),
      public_base_url: 'http://coworker.test/v1/runtime-environments/env_1/preview/3210',
    });

    const forwarded_headers = new Headers(fetch_mock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(forwarded_headers.get('authorization')).toBeNull();
    expect(forwarded_headers.get('cookie')).toBeNull();
    expect(forwarded_headers.get('referer')).toBeNull();
    expect(forwarded_headers.get('x-api-key')).toBeNull();
    expect(forwarded_headers.get('x-csrf-token')).toBeNull();
    expect([...forwarded_headers.keys()].filter((name) => name.startsWith('x-'))).toEqual([]);
    expect(forwarded_headers.get('accept')).toBe('text/html');
    expect(response.headers.get('clear-site-data')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(response.text()).resolves.toBe('ok');
  });

  it('reports E2B closed-port responses as preview unavailability', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('Port 3210 is not open in this E2B sandbox', { status: 502 });
      }),
    );
    const { E2bPreviewUnavailableError, proxy_e2b_preview_request } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    await expect(
      proxy_e2b_preview_request({
        provider_sandbox_id: 'sbox_test',
        port: 3210,
        path: '/',
        search: '',
        request: new Request('http://coworker.test/preview'),
        public_base_url: 'http://coworker.test/v1/runtime-environments/env_1/preview/3210',
      }),
    ).rejects.toBeInstanceOf(E2bPreviewUnavailableError);
  });
});

describe('e2b session environment setup', () => {
  it('repairs the directory layout in one command when reconnecting to a sandbox', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    e2b_mocks.connect.mockResolvedValue({
      sandboxId: 'sbox_existing',
      getHost: () => '3000-test.e2b.app',
      commands: { run },
    });
    const { create_e2b_session_env } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    await create_e2b_session_env({
      runtime_environment_id: 'renv_1',
      sandbox_id: 'sbox_existing',
      workspace_mount_key: 'ws_1:ses_1',
      run_id: 'run_1',
      agent_id: 'ag_test',
      host_workspace_root: '/tmp/work',
      workspace_directories: ['people', 'files'],
    });

    expect(e2b_mocks.connect).toHaveBeenCalledWith('sbox_existing', expect.any(Object));
    expect(e2b_mocks.create).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      "mkdir -p -- '/workspace' '/workspace/people' '/workspace/files'",
    );
  });

  it('creates the directory layout in one command for a new sandbox', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    e2b_mocks.create.mockResolvedValue({
      sandboxId: 'sbox_new',
      getHost: () => '3000-test.e2b.app',
      commands: { run },
    });
    const { create_e2b_session_env } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    await create_e2b_session_env({
      runtime_environment_id: 'renv_1',
      workspace_mount_key: 'ws_1:ses_1',
      run_id: 'run_1',
      agent_id: 'ag_test',
      host_workspace_root: '/tmp/work',
      workspace_directories: ['people', 'files'],
    });

    expect(e2b_mocks.create).toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      "mkdir -p -- '/workspace' '/workspace/people' '/workspace/files'",
    );
  });

  it('mounts the Archil disk shared and hands root ownership to the runtime user', async () => {
    let disk_mounted = false;
    const run = vi.fn(async (command: string, _options?: { user?: string }) => {
      if (command.startsWith("'archil' 'mount'")) disk_mounted = true;
      return {
        exitCode:
          (command.includes("stat -c '%u:%g'") && command.includes('system/layout.json')) ||
          (command.startsWith("'mountpoint'") && !disk_mounted)
            ? 1
            : 0,
        stdout: command.startsWith("printf '%s:%s'") ? '1001:1001' : '',
        stderr: '',
      };
    });
    e2b_mocks.create.mockResolvedValue({
      sandboxId: 'sbox_recovered',
      getHost: () => '3000-test.e2b.app',
      commands: { run },
    });
    const { create_e2b_session_env } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    await create_e2b_session_env({
      runtime_environment_id: 'renv_1',
      workspace_mount_key: 'workspace:ws_1:ses_1',
      run_id: 'run_recovery',
      agent_id: 'ag_test',
      host_workspace_root: '/workspace',
      workspace_directories: ['people'],
      volume: persistent_test_volume(),
    });

    const { env } = await import('@coworker/config');
    expect(e2b_mocks.create).toHaveBeenCalledWith(
      env.COWORKER_E2B_TEMPLATE_ID,
      expect.objectContaining({
        timeoutMs: 60 * 60 * 1000,
        lifecycle: { onTimeout: 'kill' },
      }),
    );
    expect(run.mock.calls.map(([command]) => command)).toContain(
      "'archil' 'mount' 'dsk_1' '/mnt/coworker' '--region' 'aws-us-east-1' '--shared'",
    );
    expect(run.mock.calls.map(([command]) => command)).toContain(
      "'archil' 'checkout' '/mnt/coworker'",
    );
    expect(run.mock.calls.map(([command]) => command)).toContain(
      "'archil' 'checkin' '/mnt/coworker'",
    );
    expect(
      run.mock.calls.some(
        ([command, options]) =>
          command.includes('-name .archil -prune') &&
          command.includes("chown -P '1001:1001' --") &&
          command.includes("'/mnt/coworker/agents/ag_test/workspace'") &&
          options?.user === 'root',
      ),
    ).toBe(true);
    expect(
      run.mock.calls.some(
        ([command, options]) =>
          command.includes("chown -h '1001:1001' -- /tmp/coworker") && options?.user === 'root',
      ),
    ).toBe(true);
    expect(
      run.mock.calls.some(
        ([command, options]) =>
          command.includes("mkdir -p -- '/mnt/coworker/agents/ag_test/workspace/people'") &&
          options?.user === undefined,
      ),
    ).toBe(true);
    expect(
      run.mock.calls.some(
        ([command, options]) =>
          command.includes("mount --bind '/mnt/coworker/agents/ag_test/workspace' '/workspace'") &&
          !command.includes('chmod') &&
          options?.user === 'root',
      ),
    ).toBe(true);
  });

  it('surfaces a root ownership handoff failure and kills the failed sandbox', async () => {
    const kill = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) => {
      if (command.startsWith("printf '%s:%s'")) {
        return { exitCode: 0, stdout: '1001:1001', stderr: '' };
      }
      if (command.includes("stat -c '%u:%g'") && command.includes('system/layout.json')) {
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      if (command.includes('xargs -0 -r chown -P')) {
        return { exitCode: 1, stdout: '', stderr: 'permission denied' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.create.mockResolvedValue({
      sandboxId: 'sbox_failed_handoff',
      getHost: () => '3000-test.e2b.app',
      commands: { run },
      kill,
    });
    const { create_e2b_session_env } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    await expect(
      create_e2b_session_env({
        runtime_environment_id: 'renv_1',
        workspace_mount_key: 'workspace:ws_1:ses_1',
        run_id: 'run_recovery',
        agent_id: 'ag_test',
        host_workspace_root: '/work',
        workspace_directories: ['repo'],
        volume: persistent_test_volume(),
      }),
    ).rejects.toThrow(/ownership handoff failed: permission denied/iu);
    expect(kill).toHaveBeenCalledOnce();
  });

  it('reclaims a stale browser-state delegation on the last attempt', async () => {
    const kill = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) => {
      if (command.includes("'checkout'") && !command.includes("'--force'")) {
        return { exitCode: 1, stdout: '', stderr: 'path has an outstanding delegation' };
      }
      if (command.includes("'--force'") && !command.includes("'--yes'")) {
        return { exitCode: 1, stdout: '', stderr: 'aborted: confirmation required' };
      }
      if (command.includes('agent-browser')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ success: true, data: { saveStatus: 'saved', saveError: null } }),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.connect.mockResolvedValue({ commands: { run }, kill });
    const { stop_e2b_sandbox } = await import('@runtime-platform/orchestrator/e2b_sandbox_client');

    vi.useFakeTimers();
    const teardown = stop_e2b_sandbox({
      provider_sandbox_id: 'sbox_persistent',
      archil_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/ag_test/workspace',
      workspace_layout_version: 2,
      browser_command_env: { AGENT_BROWSER_SESSION: 'workspace_test' },
      reclaim_stuck_browser_state: true,
    });
    await vi.runAllTimersAsync();
    await teardown;
    vi.useRealTimers();

    const commands = run.mock.calls.map(([command]) => command);
    expect(commands).toContain(
      "'archil' 'checkout' '--force' '--yes' '/mnt/coworker/agents/ag_test/workspace/system/browser/sessions'",
    );
    expect(commands).toContain(
      "'archil' 'checkout' '--force' '--yes' '/mnt/coworker/agents/ag_test/workspace/system/browser/auth'",
    );
    expect(
      commands.indexOf(
        "'archil' 'checkout' '/mnt/coworker/agents/ag_test/workspace/system/browser/sessions'",
      ),
    ).toBeLessThan(
      commands.indexOf(
        "'archil' 'checkout' '--force' '--yes' '/mnt/coworker/agents/ag_test/workspace/system/browser/sessions'",
      ),
    );
    expect(commands).toContain("'agent-browser' '--json' 'close'");
  });

  it('never reclaims a browser-state delegation while setting a session up', async () => {
    const run = vi.fn(async (command: string) => {
      if (command.includes("'checkout'") && command.includes('browser-')) {
        return { exitCode: 1, stdout: '', stderr: 'path has an outstanding delegation' };
      }
      if (command.includes('mountpoint')) return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const { claim_browser_state_ownership } = await import(
      '@runtime-platform/orchestrator/e2b_volume'
    );

    vi.useFakeTimers();
    const claiming = claim_browser_state_ownership(
      { commands: { run } } as never,
      '/mnt/coworker',
      'ag_test',
    );
    await vi.runAllTimersAsync();
    await claiming;
    vi.useRealTimers();

    expect(run.mock.calls.map(([command]) => command as string).join('\n')).not.toContain(
      "'--force'",
    );
  });

  it('says the delegation is missing instead of writing to a read-only path', async () => {
    const kill = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) => {
      if (command.includes("'checkout'")) {
        return { exitCode: 1, stdout: '', stderr: 'permission denied' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.connect.mockResolvedValue({ commands: { run }, kill });
    const { E2bWorkspaceStopError, stop_e2b_sandbox } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    const error = await stop_e2b_sandbox({
      provider_sandbox_id: 'sbox_persistent',
      archil_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/ag_test/workspace',
      workspace_layout_version: 2,
      browser_command_env: { AGENT_BROWSER_SESSION: 'workspace_test' },
      reclaim_stuck_browser_state: true,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(E2bWorkspaceStopError);
    expect(error).toMatchObject({
      message: expect.stringContaining('no write ownership'),
    });
    expect(run.mock.calls.map(([command]) => command)).not.toContain(
      "'agent-browser' '--json' 'close'",
    );
    expect(run.mock.calls.map(([command]) => command)).toContain('sync');
    expect(kill).toHaveBeenCalledOnce();
  });
});

describe('e2b persistent workspace teardown', () => {
  it('treats a missing sandbox as stopped without claiming that the volume synced', async () => {
    e2b_mocks.connect.mockRejectedValue(
      new e2b_mocks.SandboxNotFoundError('Paused sandbox sbox_missing not found'),
    );
    const { stop_e2b_sandbox } = await import('@runtime-platform/orchestrator/e2b_sandbox_client');

    await expect(
      stop_e2b_sandbox({
        provider_sandbox_id: 'sbox_missing',
        archil_root_path: '/mnt/coworker',
      }),
    ).resolves.toEqual({ volume_synced: false, sandbox_kept: false });
  });

  it('reports browser save failure after still attempting sync, unmount, and sandbox kill', async () => {
    const kill = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) => {
      if (command.includes('agent-browser')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            success: true,
            data: { saveStatus: 'skipped_restore_failed', saveError: 'state write failed' },
          }),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.connect.mockResolvedValue({ commands: { run }, kill });
    const { E2bWorkspaceStopError, stop_e2b_sandbox } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    const error = await stop_e2b_sandbox({
      provider_sandbox_id: 'sbox_persistent',
      archil_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/ag_test/workspace',
      workspace_layout_version: 2,
      browser_command_env: { AGENT_BROWSER_SESSION: 'workspace_test' },
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(E2bWorkspaceStopError);
    expect(error).toMatchObject({
      message: expect.stringContaining('Browser state save failed'),
    });
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      "'archil' 'checkout' '/mnt/coworker/agents/ag_test/workspace/system/browser/sessions'",
      "'archil' 'checkout' '/mnt/coworker/agents/ag_test/workspace/system/browser/auth'",
      "'agent-browser' '--json' 'close'",
      "'archil' 'checkin' '/mnt/coworker/agents/ag_test/workspace/system/browser/sessions'",
      "'archil' 'checkin' '/mnt/coworker/agents/ag_test/workspace/system/browser/auth'",
      'sync',
      "mountpoint -q '/workspace' || exit 0\numount '/workspace' || umount -l '/workspace'",
      "'archil' 'unmount' '/mnt/coworker'",
    ]);
    expect(kill).toHaveBeenCalledOnce();
  });
});

describe('an unmount that hangs', () => {
  const timeout_error = () =>
    Object.assign(new Error('[deadline_exceeded] the operation timed out'), {
      name: 'TimeoutError',
    });

  it('is a failed attempt, so it is retried like any other', async () => {
    const kill = vi.fn(async () => undefined);
    let unmounts = 0;
    const run = vi.fn(async (command: string) => {
      if (command.includes('unmount')) {
        unmounts += 1;
        if (unmounts <= 2) throw timeout_error();
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.connect.mockResolvedValue({ commands: { run }, kill });
    const { stop_e2b_sandbox } = await import('@runtime-platform/orchestrator/e2b_sandbox_client');

    vi.useFakeTimers();
    const teardown = stop_e2b_sandbox({
      provider_sandbox_id: 'sbox_persistent',
      archil_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/ag_test/workspace',
      workspace_layout_version: 2,
    });
    await vi.runAllTimersAsync();
    const result = await teardown;
    vi.useRealTimers();

    expect(unmounts).toBe(3);
    expect(result).toEqual({ volume_synced: true, sandbox_kept: false });
    expect(kill).toHaveBeenCalled();
  });

  it('says which command timed out, and who was holding the mount', async () => {
    const kill = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) => {
      if (command.includes('unmount')) throw timeout_error();
      if (command.includes('/proc/[0-9]*')) {
        return {
          exitCode: 0,
          stdout: 'chrome /proc/412/cwd -> /mnt/coworker/agents\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.connect.mockResolvedValue({ commands: { run }, kill });
    const { E2bWorkspaceStopError, stop_e2b_sandbox } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    vi.useFakeTimers();
    const teardown = stop_e2b_sandbox({
      provider_sandbox_id: 'sbox_persistent',
      archil_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/ag_test/workspace',
      workspace_layout_version: 2,
    }).catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    const error = await teardown;
    vi.useRealTimers();

    expect(error).toBeInstanceOf(E2bWorkspaceStopError);
    expect(error).toMatchObject({
      message: expect.stringContaining('Archil unmount of /mnt/coworker failed after 3 attempts'),
    });
    expect((error as Error).message).toContain('deadline_exceeded');
    expect((error as Error).message).toContain('chrome');
    expect(kill).toHaveBeenCalled();
  });
});

describe('releasing the disk', () => {
  it('takes the bind off the model root before unmounting the disk under it', async () => {
    const order: string[] = [];
    const kill = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) => {
      if (command.includes('umount') && command.includes('/workspace')) order.push('release bind');
      else if (command.includes('archil') && command.includes('unmount'))
        order.push('unmount disk');
      else if (command.trim() === 'sync') order.push('sync');
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.connect.mockResolvedValue({ commands: { run }, kill });
    const { stop_e2b_sandbox } = await import('@runtime-platform/orchestrator/e2b_sandbox_client');

    await stop_e2b_sandbox({
      provider_sandbox_id: 'sbox_persistent',
      archil_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/ag_test/workspace',
      workspace_layout_version: 2,
    });

    expect(order).toEqual(['sync', 'release bind', 'unmount disk']);
  });

  it('does not fail teardown when there is no bind to release', async () => {
    const kill = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) => {
      if (command.includes('mountpoint')) return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.connect.mockResolvedValue({ commands: { run }, kill });
    const { stop_e2b_sandbox } = await import('@runtime-platform/orchestrator/e2b_sandbox_client');

    const result = await stop_e2b_sandbox({
      provider_sandbox_id: 'sbox_persistent',
      archil_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/ag_test/workspace',
      workspace_layout_version: 2,
    });
    expect(result).toEqual({ volume_synced: true, sandbox_kept: false });
  });

  it('names the holder from /proc, not from a package the image lacks', async () => {
    const kill = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) => {
      if (command.includes('archil') && command.includes('unmount')) {
        return { exitCode: 1, stdout: '', stderr: 'target is busy' };
      }
      if (command.includes('/proc/[0-9]*')) {
        return {
          exitCode: 0,
          stdout: 'chrome /proc/412/cwd -> /mnt/coworker/agents\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    e2b_mocks.connect.mockResolvedValue({ commands: { run }, kill });
    const { E2bWorkspaceStopError, stop_e2b_sandbox } = await import(
      '@runtime-platform/orchestrator/e2b_sandbox_client'
    );

    vi.useFakeTimers();
    const teardown = stop_e2b_sandbox({
      provider_sandbox_id: 'sbox_persistent',
      archil_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/ag_test/workspace',
      workspace_layout_version: 2,
    }).catch((failure: unknown) => failure);
    await vi.runAllTimersAsync();
    const error = await teardown;
    vi.useRealTimers();

    expect(error).toBeInstanceOf(E2bWorkspaceStopError);
    expect((error as Error).message).toContain('chrome /proc/412/cwd');
    expect((error as Error).message).not.toContain('fuser');
    expect(run.mock.calls.some(([command]) => String(command).includes('fuser'))).toBe(false);
  });
});
