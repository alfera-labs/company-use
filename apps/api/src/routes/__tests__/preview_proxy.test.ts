import { sandbox_preview_base_domain } from '@coworker/config/hosted_defaults';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime_mocks = vi.hoisted(() => {
  const previous_openai_api_key = process.env.OPENAI_API_KEY;
  const previous_workspace_provider = process.env.COWORKER_WORKSPACE_RUNTIME_PROVIDER;
  process.env.OPENAI_API_KEY = 'test_openai_key';
  process.env.COWORKER_WORKSPACE_RUNTIME_PROVIDER = 'local';
  return {
    previous_openai_api_key,
    previous_workspace_provider,
    proxy_e2b_preview_request: vi.fn(),
    restart_e2b_preview: vi.fn(),
  };
});

vi.mock('@coworker/runtime-platform', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/runtime-platform')>();
  return {
    ...actual,
    proxy_e2b_preview_request: runtime_mocks.proxy_e2b_preview_request,
    restart_e2b_preview: runtime_mocks.restart_e2b_preview,
  };
});

afterEach(() => {
  runtime_mocks.proxy_e2b_preview_request.mockReset();
  runtime_mocks.restart_e2b_preview.mockReset();
  restore_env('OPENAI_API_KEY', runtime_mocks.previous_openai_api_key);
  restore_env('COWORKER_WORKSPACE_RUNTIME_PROVIDER', runtime_mocks.previous_workspace_provider);
  vi.resetModules();
});

function restore_env(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe('preview proxy routes', () => {
  it('proxies hostname previews resolved from an active sandbox preview', async () => {
    const { create_app } = await import('@api/app');
    const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
    const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
    const { create_runtime_environment, create_session } = await import(
      '@coworker/core/db/queries/sessions'
    );
    const { list_session_sandbox_url_previews } = await import(
      '@coworker/core/db/queries/runtime_environments'
    );
    const db = await create_test_database();
    const app = create_app(db);
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Active preview proxy test',
      actor_id: bootstrap.user_id,
    });
    await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'sbox_generated',
      workspace_mount_key: `${bootstrap.workspace_id}:${session.session_id}`,
      root_path: '/work',
      environment_metadata: {
        active_preview_ports: [3000],
        active_previews: {
          '3000': { port: 3000 },
        },
      },
      actor_id: bootstrap.user_id,
    });
    const previews = await list_session_sandbox_url_previews(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      options: {
        preview_base_domain: sandbox_preview_base_domain,
        preview_protocol: 'https',
        default_port: 3000,
      },
    });
    const preview = previews?.[0];
    if (!preview) throw new Error('Expected active preview URL.');
    runtime_mocks.proxy_e2b_preview_request.mockResolvedValueOnce(new Response('active ok'));

    const response = await app.request('/internal/sandbox-preview-proxy/assets/app.js?cache=1', {
      headers: {
        'x-coworker-api-secret': 'local-development-internal-api-secret',
        'x-coworker-preview-host': preview.preview_domain,
      },
    });

    await expect(response.text()).resolves.toBe('active ok');
    expect(response.status).toBe(200);
    expect(runtime_mocks.proxy_e2b_preview_request).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_sandbox_id: 'sbox_generated',
        port: 3000,
        path: '/assets/app.js',
        search: '?cache=1',
        public_base_url: preview.preview_url,
      }),
    );
  }, 60_000);

  it('restarts a stale E2B preview from persisted launch metadata before retrying proxy', async () => {
    const { create_app } = await import('@api/app');
    const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
    const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
    const { create_runtime_environment, create_session, get_runtime_environment } = await import(
      '@coworker/core/db/queries/sessions'
    );
    const { E2bPreviewUnavailableError } = await import('@coworker/runtime-platform');
    const db = await create_test_database();
    const app = create_app(db);
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Preview restart test',
      actor_id: bootstrap.user_id,
    });
    const runtime_environment = await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'sbox_test',
      workspace_mount_key: `${bootstrap.workspace_id}:${session.session_id}`,
      root_path: '/work',
      environment_metadata: {
        active_preview: {
          port: 3000,
          launch_command: 'npm',
          launch_args: ['run', 'dev'],
          command: 'npm run dev',
          cwd: '/work/repo',
          ready_path: '/',
        },
        active_preview_ports: [3000],
        active_previews: {
          '3000': {
            port: 3000,
            launch_command: 'npm',
            launch_args: ['run', 'dev'],
            command: 'npm run dev',
            cwd: '/work/repo',
            ready_path: '/',
          },
        },
      },
      actor_id: bootstrap.user_id,
    });
    runtime_mocks.proxy_e2b_preview_request
      .mockRejectedValueOnce(new E2bPreviewUnavailableError('port closed'))
      .mockResolvedValueOnce(new Response('preview ok'));
    runtime_mocks.restart_e2b_preview.mockResolvedValue({
      port: 3000,
      process_id: 456,
      command: 'npm run dev',
      cwd: '/work/repo',
      ready_url: 'https://example.test/',
    });

    const response = await app.request(
      `/v1/runtime-environments/${runtime_environment.runtime_environment_id}/preview/3000/`,
    );
    const updated_environment = await get_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
    });

    await expect(response.text()).resolves.toBe('preview ok');
    expect(response.status).toBe(200);
    expect(runtime_mocks.restart_e2b_preview).toHaveBeenCalledWith({
      provider_sandbox_id: 'sbox_test',
      port: 3000,
      command: 'npm',
      args: ['run', 'dev'],
      cwd: '/work/repo',
      ready_path: '/',
      timeout_ms: 30_000,
    });
    expect(runtime_mocks.proxy_e2b_preview_request).toHaveBeenCalledTimes(2);
    expect(updated_environment?.environment_metadata).toMatchObject({
      active_preview: {
        port: 3000,
        process_id: 456,
        launch_command: 'npm',
        launch_args: ['run', 'dev'],
      },
      active_previews: {
        '3000': {
          process_id: 456,
        },
      },
    });
  }, 60_000);
});
