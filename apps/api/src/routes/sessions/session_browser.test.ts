import { create_app } from '@api/app';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  acquire_session_execution_lock,
  create_run,
  create_session,
  get_runtime_environment,
  get_session,
  list_session_runs,
  update_session_runtime_environment,
} from '@coworker/core/db/queries/sessions';
import { connect_e2b_session_env } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import {
  mark_coding_workspace_idle,
  open_or_create_coding_workspace,
  settled_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import { Sandbox } from 'e2b';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  browser_fails: false,
  relay_fails: false,
  expired: false,
  next_id: 0,
  commands: [] as string[],
}));

vi.mock('@coworker/config', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/config')>();
  return { ...actual, env: { ...actual.env, COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'e2b' } };
});

vi.mock('e2b', async (import_original) => {
  const actual = await import_original<typeof import('e2b')>();
  const sandbox = (sandbox_id: string) => ({
    sandboxId: sandbox_id,
    getHost: (port: number) => `${port}-${sandbox_id}.e2b.app`,
    updateNetwork: vi.fn(),
    kill: vi.fn(),
    commands: {
      run: vi.fn(async (command: string, options?: { background?: boolean }) => {
        provider.commands.push(command);
        if (provider.relay_fails && options?.background) throw new Error('Relay binary missing');
        if (options?.background) {
          return { pid: 123, wait: () => new Promise(() => {}), kill: vi.fn() };
        }
        return {
          exitCode: provider.browser_fails && command.includes('agent-browser') ? 1 : 0,
          stdout: 'about:blank',
          stderr: '',
        };
      }),
      kill: vi.fn(),
    },
  });
  return {
    ...actual,
    Sandbox: {
      create: vi.fn(async () => sandbox(`browser-test-${++provider.next_id}`)),
      connect: vi.fn(async (sandbox_id: string) => {
        if (provider.expired) throw new actual.SandboxNotFoundError('Sandbox expired');
        return sandbox(sandbox_id);
      }),
      kill: vi.fn(),
      pause: vi.fn(),
      setTimeout: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  provider.browser_fails = false;
  provider.relay_fails = false;
  provider.expired = false;
  provider.commands = [];
});

async function create_chat() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    session_title: 'Browser startup',
  });
  return { db, bootstrap, session, app: create_app(db) };
}

describe('POST /v1/sessions/:session_id/browser/start', () => {
  it('boots once, returns the stored token, and reuses compute for the next run', async () => {
    const { db, bootstrap, session, app } = await create_chat();
    const url = `/v1/sessions/${session.session_id}/browser/start`;
    const responses = await Promise.all([
      app.request(url, { method: 'POST' }),
      app.request(url, { method: 'POST' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const first = await responses[0]?.json();
    expect(first.data).toMatchObject({
      preview_kind: 'browser_live_view',
      live_view_token: expect.any(String),
    });
    expect(first.data.live_view_token).toHaveLength(64);
    expect(Sandbox.create).toHaveBeenCalledTimes(1);
    expect(await list_session_runs(db, bootstrap.workspace_id, session.session_id)).toHaveLength(0);
    expect(
      (await get_session(db, bootstrap.workspace_id, session.session_id))?.locked_by_run_id,
    ).toBeNull();
    const reopened = await app.request(url, { method: 'POST' });
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).data.live_view_token).toBe(first.data.live_view_token);
    const next_workspace = await settled_coding_workspace(
      await open_or_create_coding_workspace(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        actor_id: bootstrap.user_id,
        run_id: 'run_next',
        provider: 'e2b',
      }),
    );
    expect(Sandbox.create).toHaveBeenCalledTimes(1);
    vi.mocked(Sandbox.setTimeout).mockClear();
    await mark_coding_workspace_idle(db, {
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: next_workspace.runtime_environment_id,
      close_token: next_workspace.close_token,
      actor_id: bootstrap.user_id,
    });
    expect(Sandbox.setTimeout).toHaveBeenCalledWith(
      next_workspace.close_token.provider_environment_id,
      env.COWORKER_E2B_TIMEOUT_MS,
    );
  });

  it('attaches during an active run without changing its lifecycle', async () => {
    const { db, bootstrap, session, app } = await create_chat();
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
      trigger_type: 'user_message',
    });
    await acquire_session_execution_lock(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      actor_id: bootstrap.user_id,
    });
    const workspace = await open_or_create_coding_workspace(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
      run_id: run.run_id,
      provider: 'e2b',
    });
    await update_session_runtime_environment(db, {
      session_id: session.session_id,
      runtime_environment_id: workspace.runtime_environment_id,
      actor_id: bootstrap.user_id,
    });
    const response = await app.request(`/v1/sessions/${session.session_id}/browser/start`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(Sandbox.create).toHaveBeenCalledTimes(1);
    expect(
      (await get_session(db, bootstrap.workspace_id, session.session_id))?.locked_by_run_id,
    ).toBe(run.run_id);
    const environment = await get_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: workspace.runtime_environment_id,
    });
    expect(environment?.environment_metadata.browser_started).toBeUndefined();
  });

  it('prepares adopted volume scratch and certificate trust without mounting again', async () => {
    await connect_e2b_session_env({
      runtime_environment_id: 'renv_adopted',
      sandbox_id: 'sandbox_adopted',
      workspace_mount_key: 'workspace:ws_1:ses_1',
      run_id: 'run_adopted',
      agent_id: 'agent_1',
      host_workspace_root: '/work',
      workspace_directories: [],
      network_rules: { 'example.com': [{ transform: { headers: { Authorization: 'test' } } }] },
      volume: {
        volume_id: 'vol_1',
        provider: 'archil',
        provider_volume_id: 'disk_1',
        workspace_mount_key: 'workspace:ws_1:ses_1',
        root_path: '/mnt/coworker',
        workspace_layout_version: 2,
        mount_token: 'test',
      },
    });
    const commands = provider.commands.join('\n');
    expect(commands).toContain('/tmp/coworker/run_adopted');
    expect(commands).toContain('certutil');
    expect(commands).toContain('mountpoint');
    expect(commands).not.toContain("'archil' 'mount'");
    expect(Sandbox.create).not.toHaveBeenCalled();
  });

  it('creates fresh compute after the saved sandbox expires', async () => {
    const { app, session } = await create_chat();
    const url = `/v1/sessions/${session.session_id}/browser/start`;
    expect((await app.request(url, { method: 'POST' })).status).toBe(200);
    provider.expired = true;
    expect((await app.request(url, { method: 'POST' })).status).toBe(200);
    expect(Sandbox.create).toHaveBeenCalledTimes(2);
  });

  it('returns a startup error and releases the session when Chrome fails', async () => {
    const { db, bootstrap, session, app } = await create_chat();
    provider.browser_fails = true;
    const response = await app.request(`/v1/sessions/${session.session_id}/browser/start`, {
      method: 'POST',
    });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('browser_start_failed');
    expect(
      (await get_session(db, bootstrap.workspace_id, session.session_id))?.locked_by_run_id,
    ).toBeNull();
    expect(await list_session_runs(db, bootstrap.workspace_id, session.session_id)).toHaveLength(0);
  });

  it('does not return success when the relay fails', async () => {
    const { session, app } = await create_chat();
    provider.relay_fails = true;
    const response = await app.request(`/v1/sessions/${session.session_id}/browser/start`, {
      method: 'POST',
    });
    expect(response.status).toBe(500);
    const previews = await app.request(`/v1/sessions/${session.session_id}/sandbox-previews`);
    expect((await previews.json()).data).toEqual([]);
  });

  it('rejects an unsigned user identity before calling the provider', async () => {
    const { app, session } = await create_chat();
    const response = await app.request(`/v1/sessions/${session.session_id}/browser/start`, {
      method: 'POST',
      headers: { 'x-coworker-auth-provider': 'workos', 'x-coworker-auth-user-id': 'unsigned' },
    });
    expect(response.status).toBe(401);
    expect(Sandbox.create).not.toHaveBeenCalled();
    expect(Sandbox.connect).not.toHaveBeenCalled();
  });

  it('rejects unknown sessions before calling the provider', async () => {
    const { app } = await create_chat();
    const response = await app.request('/v1/sessions/ses_missing/browser/start', {
      method: 'POST',
    });
    expect(response.status).toBe(404);
    expect(Sandbox.create).not.toHaveBeenCalled();
    expect(Sandbox.connect).not.toHaveBeenCalled();
  });
});
