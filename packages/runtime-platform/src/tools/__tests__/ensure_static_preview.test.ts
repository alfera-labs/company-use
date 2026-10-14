import { describe, expect, it, vi } from 'vitest';

async function setup() {
  const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
  const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
  const { create_session, create_runtime_environment, get_runtime_environment } = await import(
    '@coworker/core/db/queries/sessions'
  );
  const { start_static_preview_if_absent } = await import(
    '@runtime-platform/tools/tool_execution_service'
  );
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Static preview fallback test',
    actor_id: bootstrap.user_id,
  });
  return {
    db,
    bootstrap,
    session,
    create_runtime_environment,
    get_runtime_environment,
    start_static_preview_if_absent,
  };
}

describe('start_static_preview_if_absent', () => {
  it('starts a static server and persists an active preview for static output with none running', async () => {
    const s = await setup();
    const env_row = await s.create_runtime_environment(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      session_id: s.session.session_id,
      agent_id: s.bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'idle',
      provider_environment_id: 'sbox_static',
      workspace_mount_key: `${s.bootstrap.workspace_id}:${s.session.session_id}`,
      root_path: '/work',
      actor_id: s.bootstrap.user_id,
    });
    const exec = vi.fn().mockResolvedValue({ exit_code: 0, stdout: 'static\n', stderr: '' });
    const start_preview = vi.fn().mockResolvedValue({
      port: 3000,
      process_id: 42,
      command: 'python3 -m http.server 3000',
      cwd: '/work/repo',
    });

    await s.start_static_preview_if_absent(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      runtime_environment_id: env_row.runtime_environment_id,
      environment: { exec, start_preview } as never,
      actor_id: s.bootstrap.user_id,
    });

    expect(start_preview).toHaveBeenCalledOnce();
    const updated = await s.get_runtime_environment(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      runtime_environment_id: env_row.runtime_environment_id,
    });
    expect(updated?.environment_status).toBe('running');
    expect(updated?.environment_metadata).toMatchObject({
      active_previews: { '3000': { port: 3000, launch_command: 'python3' } },
    });
  });

  it('does nothing when the workspace is not a static site', async () => {
    const s = await setup();
    const env_row = await s.create_runtime_environment(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      session_id: s.session.session_id,
      agent_id: s.bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'idle',
      provider_environment_id: 'sbox_framework',
      workspace_mount_key: `${s.bootstrap.workspace_id}:${s.session.session_id}`,
      root_path: '/work',
      actor_id: s.bootstrap.user_id,
    });
    const exec = vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: '' });
    const start_preview = vi.fn();

    await s.start_static_preview_if_absent(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      runtime_environment_id: env_row.runtime_environment_id,
      environment: { exec, start_preview } as never,
      actor_id: s.bootstrap.user_id,
    });

    expect(start_preview).not.toHaveBeenCalled();
  });

  it('does nothing when a preview is already active', async () => {
    const s = await setup();
    const env_row = await s.create_runtime_environment(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      session_id: s.session.session_id,
      agent_id: s.bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'sbox_already',
      workspace_mount_key: `${s.bootstrap.workspace_id}:${s.session.session_id}`,
      root_path: '/work',
      environment_metadata: {
        active_preview_ports: [3000],
        active_previews: { '3000': { port: 3000 } },
      },
      actor_id: s.bootstrap.user_id,
    });
    const exec = vi.fn().mockResolvedValue({ exit_code: 0, stdout: 'static\n', stderr: '' });
    const start_preview = vi.fn();

    await s.start_static_preview_if_absent(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      runtime_environment_id: env_row.runtime_environment_id,
      environment: { exec, start_preview } as never,
      actor_id: s.bootstrap.user_id,
    });

    expect(start_preview).not.toHaveBeenCalled();
  });

  it('still starts an app preview when only the browser dashboard is active', async () => {
    const s = await setup();
    const env_row = await s.create_runtime_environment(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      session_id: s.session.session_id,
      agent_id: s.bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'sbox_browser_only',
      workspace_mount_key: `${s.bootstrap.workspace_id}:${s.session.session_id}`,
      root_path: '/work',
      environment_metadata: {
        active_preview_ports: [4848],
        active_previews: {
          '4848': { port: 4848, preview_kind: 'browser_live_view' },
        },
      },
      actor_id: s.bootstrap.user_id,
    });
    const exec = vi.fn().mockResolvedValue({ exit_code: 0, stdout: 'static\n', stderr: '' });
    const start_preview = vi.fn().mockResolvedValue({
      port: 3000,
      process_id: 42,
      command: 'python3 -m http.server 3000',
      cwd: '/work/repo',
    });

    await s.start_static_preview_if_absent(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      runtime_environment_id: env_row.runtime_environment_id,
      environment: { exec, start_preview } as never,
      actor_id: s.bootstrap.user_id,
    });

    expect(start_preview).toHaveBeenCalledOnce();
    const updated = await s.get_runtime_environment(s.db, {
      workspace_id: s.bootstrap.workspace_id,
      runtime_environment_id: env_row.runtime_environment_id,
    });
    expect(updated?.environment_metadata).toMatchObject({
      active_previews: {
        '3000': { port: 3000, launch_command: 'python3' },
        '4848': { port: 4848, preview_kind: 'browser_live_view' },
      },
    });
  });
});
