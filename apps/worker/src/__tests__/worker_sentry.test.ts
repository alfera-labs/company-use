import { key_shaped_value } from '@coworker/shared/test_support/key_shaped_value';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry_mocks = vi.hoisted(() => ({
  capture_exception: vi.fn(),
  console_logging_integration: vi.fn(() => ({ name: 'ConsoleLogs' })),
  init: vi.fn(),
  postgres_integration: vi.fn(() => ({ name: 'Postgres' })),
}));

vi.mock('@sentry/node', () => ({
  captureException: sentry_mocks.capture_exception,
  consoleLoggingIntegration: sentry_mocks.console_logging_integration,
  init: sentry_mocks.init,
  postgresIntegration: sentry_mocks.postgres_integration,
}));

describe('worker sentry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing when no DSN is set', async () => {
    stub_sentry_dsn(undefined);
    const sentry = await import('@worker/worker_sentry');

    sentry.initialize_worker_sentry();
    sentry.capture_worker_exception(new Error('not sent'), { failure: 'queue_drain' });

    expect(sentry_mocks.init).not.toHaveBeenCalled();
    expect(sentry_mocks.capture_exception).not.toHaveBeenCalled();
  });

  it('initializes once, tags every event service=worker, and scrubs credentials', async () => {
    stub_sentry_dsn('https://public@example.ingest.sentry.io/1');
    vi.stubEnv('ENVIRONMENT', 'staging');
    const sentry = await import('@worker/worker_sentry');

    sentry.initialize_worker_sentry();
    sentry.initialize_worker_sentry();

    expect(sentry_mocks.init).toHaveBeenCalledTimes(1);
    const options = sentry_mocks.init.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      dsn: 'https://public@example.ingest.sentry.io/1',
      environment: 'staging',
      initialScope: { tags: { service: 'worker' } },
      sendDefaultPii: false,
    });
    const event = {
      message: `failed with ${key_shaped_value('anthropic', 'abcdefghijklmnop1234567890')}`,
    };
    expect(options.beforeSend(event).message).toBe('failed with [redacted credential]');
  });

  it('captures a drain failure with its queue', async () => {
    stub_sentry_dsn('https://k@e.io/1');
    const sentry = await import('@worker/worker_sentry');
    const error = new Error('drain failed');

    sentry.initialize_worker_sentry();
    sentry.capture_worker_exception(
      error,
      { failure: 'queue_drain', workspace_id: 'ws_1' },
      { queue_key: 'session:ses_1' },
    );

    expect(sentry_mocks.capture_exception).toHaveBeenCalledWith(error, {
      tags: { runtime: 'worker', failure: 'queue_drain', workspace_id: 'ws_1' },
      extra: { queue_key: 'session:ses_1' },
    });
  });
});

function stub_sentry_dsn(dsn: string | undefined) {
  vi.stubEnv('API_SENTRY_DSN', dsn);
  vi.stubEnv('SENTRY_DSN', undefined);
}
