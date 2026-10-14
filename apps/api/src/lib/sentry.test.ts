import type { ApiEnv } from '@api/lib/context';
import { key_shaped_value } from '@coworker/shared/test_support/key_shaped_value';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry_mocks = vi.hoisted(() => ({
  capture_exception: vi.fn(),
  console_logging_integration: vi.fn(() => ({})),
  hono_integration: vi.fn(() => ({ name: 'Hono' })),
  init: vi.fn(),
  postgres_integration: vi.fn(() => ({ name: 'Postgres' })),
  read_api_sentry_config: vi.fn(),
  set_tag: vi.fn(),
  set_user: vi.fn(),
  with_scope: vi.fn((callback: (scope: SentryTestScope) => void) => {
    callback({
      setTag: sentry_mocks.set_tag,
      setUser: sentry_mocks.set_user,
    });
  }),
}));

type SentryTestScope = {
  setTag: (key: string, value: string) => void;
  setUser: (user: { id: string }) => void;
};

vi.mock('@coworker/config', () => ({
  read_api_sentry_config: sentry_mocks.read_api_sentry_config,
}));

vi.mock('@sentry/node', () => ({
  captureException: sentry_mocks.capture_exception,
  consoleLoggingIntegration: sentry_mocks.console_logging_integration,
  honoIntegration: sentry_mocks.hono_integration,
  init: sentry_mocks.init,
  postgresIntegration: sentry_mocks.postgres_integration,
  withScope: sentry_mocks.with_scope,
}));

describe('api sentry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('does nothing when Sentry is not configured', async () => {
    sentry_mocks.read_api_sentry_config.mockReturnValue(null);
    const { capture_api_exception, capture_unhandled_exception, initialize_api_sentry } =
      await import('@api/lib/sentry');

    initialize_api_sentry();
    capture_api_exception(new Error('not captured'), fake_context());
    capture_unhandled_exception(new Error('also not captured'));

    expect(sentry_mocks.init).not.toHaveBeenCalled();
    expect(sentry_mocks.capture_exception).not.toHaveBeenCalled();
  });

  it('initializes once and removes secret request headers before sending events', async () => {
    configure_sentry({ release: 'release-1', traces_sample_rate: 0.1 });
    const { initialize_api_sentry } = await import('@api/lib/sentry');

    initialize_api_sentry();
    initialize_api_sentry();

    expect(sentry_mocks.init).toHaveBeenCalledTimes(1);
    expect(sentry_mocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@example.com/1',
        environment: 'production',
        release: 'release-1',
        sendDefaultPii: false,
        tracesSampleRate: 0.1,
        beforeSendSpan: expect.any(Function),
      }),
    );
    expect(sentry_mocks.hono_integration).toHaveBeenCalledOnce();
    expect(sentry_mocks.postgres_integration).toHaveBeenCalledOnce();

    const sentry_options = sentry_mocks.init.mock.calls[0]?.[0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };
    const event = {
      request: {
        url: 'https://api.alfera.ai/oauth/callback?code=secret_code&connection_id=conn_123',
        headers: {
          authorization: 'Bearer secret',
          Cookie: 'session=secret',
          safe_header: 'kept',
          'X-Api-Key': 'ak_live_abcdef0123456789',
          'x-coworker-api-secret': 'proxy-secret',
        },
      },
    };

    const sent = sentry_options.beforeSend(event) as typeof event;

    expect(sent.request.headers).toEqual({ safe_header: 'kept' });
    expect(sent.request.url).toContain('code=%5Bredacted%5D');
    expect(sent.request.url).toContain('connection_id=conn_123');
    expect(sent.request.url).not.toContain('secret_code');
  });

  it('redacts a credential buried in an exception before sending it', async () => {
    await import('@api/lib/sentry').then((module) => module.initialize_api_sentry());

    const sentry_options = sentry_mocks.init.mock.calls[0]?.[0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
      beforeSendLog: (log: Record<string, unknown>) => Record<string, unknown>;
    };
    const workspace_key = key_shaped_value('openai_project', 'abcdefghijklmnop1234567890QRSTUV');

    const sent = sentry_options.beforeSend({
      exception: { values: [{ value: `provider refused ${workspace_key}` }] },
      extra: { model: { api_key: workspace_key } },
    });
    const logged = sentry_options.beforeSendLog({
      message: `model call failed with ${workspace_key}`,
    });

    expect(JSON.stringify(sent)).not.toContain(workspace_key);
    expect(JSON.stringify(logged)).not.toContain(workspace_key);
  });

  it('captures unhandled exceptions tagged as api runtime errors', async () => {
    configure_sentry();
    const { capture_unhandled_exception, initialize_api_sentry } = await import('@api/lib/sentry');
    const error = new Error('background job failed');

    initialize_api_sentry();
    capture_unhandled_exception(error);

    expect(sentry_mocks.capture_exception).toHaveBeenCalledWith(error, {
      tags: { runtime: 'api' },
    });
  });

  it('captures contained event-job failures with operational context', async () => {
    configure_sentry();
    const { capture_event_job_exception, initialize_api_sentry } = await import('@api/lib/sentry');
    const error = new Error('provider request failed');

    initialize_api_sentry();
    capture_event_job_exception(error, {
      workspace_id: 'ws_123',
      queue_key: 'slack:T123:C123:thread:123',
      job_handler: 'agent_message',
      job_ids: ['job_123'],
      run_ids: ['run_123'],
      error_code: 'memory_import_archive_read_failed',
      safe_tags: { file_id: 'art_123', import_version: 'facts_v1' },
    });

    expect(sentry_mocks.capture_exception).toHaveBeenCalledWith(error, {
      tags: {
        runtime: 'event_job',
        workspace_id: 'ws_123',
        job_handler: 'agent_message',
        error_code: 'memory_import_archive_read_failed',
        file_id: 'art_123',
        import_version: 'facts_v1',
      },
      extra: {
        queue_key: 'slack:T123:C123:thread:123',
        job_ids: ['job_123'],
        run_ids: ['run_123'],
      },
    });
  });

  it('captures unexpected API errors with route and actor context', async () => {
    configure_sentry();
    const { capture_api_exception, initialize_api_sentry } = await import('@api/lib/sentry');
    const error = new Error('database failed');

    initialize_api_sentry();
    capture_api_exception(
      error,
      fake_context({
        agent_id: 'agt_123',
        user_id: 'user_123',
        workspace_id: 'ws_123',
      }),
    );

    expect(sentry_mocks.with_scope).toHaveBeenCalledTimes(1);
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('runtime', 'api');
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('method', 'POST');
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('path', '/v1/onboarding/welcome');
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('http.status_code', '500');
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('http.method', 'POST');
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('http.route', '/v1/onboarding/welcome');
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('request_id', 'request_123');
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('workspace_id', 'ws_123');
    expect(sentry_mocks.set_tag).toHaveBeenCalledWith('agent_id', 'agt_123');
    expect(sentry_mocks.set_user).toHaveBeenCalledWith({ id: 'user_123' });
    expect(sentry_mocks.capture_exception).toHaveBeenCalledWith(error, {
      mechanism: { type: 'hono.on_error', handled: false },
    });
  });
});

function configure_sentry(overrides: Record<string, unknown> = {}) {
  sentry_mocks.read_api_sentry_config.mockReturnValue({
    dsn: 'https://public@example.com/1',
    environment: 'production',
    ...overrides,
  });
}

function fake_context(
  values: Partial<Record<'agent_id' | 'user_id' | 'workspace_id', string>> = {},
) {
  return {
    get: (key: 'agent_id' | 'requestId' | 'user_id' | 'workspace_id') =>
      key === 'requestId' ? 'request_123' : values[key],
    req: {
      method: 'POST',
      path: '/v1/onboarding/welcome',
    },
  } as unknown as Context<ApiEnv>;
}
