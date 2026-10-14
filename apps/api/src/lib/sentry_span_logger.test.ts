import { log_sentry_database_span } from '@api/lib/sentry_span_logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const original_log_level = process.env.LOG_LEVEL;

beforeEach(() => {
  process.env.LOG_LEVEL = 'info';
});

afterEach(() => {
  process.env.LOG_LEVEL = original_log_level;
  vi.restoreAllMocks();
});

describe('Sentry database span logger', () => {
  it('logs sanitized postgres query durations to the operational log', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const span = postgres_span();

    expect(log_sentry_database_span(span)).toBe(span);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        '[database] query completed {"trace_id":"trace_123","span_id":"span_123","operation":"SELECT","query":"SELECT * FROM sessions WHERE workspace_id = $1","status":"ok","duration_ms":125}',
      ),
    );
  });

  it('logs failed postgres query spans at error level', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    log_sentry_database_span(postgres_span({ status: 'internal_error' }));

    expect(error).toHaveBeenCalledWith(expect.stringContaining('[database] query failed'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"duration_ms":125'));
  });

  it('ignores spans that are not postgres queries', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const span = postgres_span({ op: 'http.server', origin: 'auto.http.otel.hono' });

    expect(log_sentry_database_span(span)).toBe(span);
    expect(info).not.toHaveBeenCalled();
  });
});

function postgres_span(overrides: Partial<ReturnType<typeof base_postgres_span>> = {}) {
  return { ...base_postgres_span(), ...overrides };
}

function base_postgres_span() {
  return {
    data: { 'db.operation.name': 'SELECT', 'db.system.name': 'postgres' },
    description: 'SELECT * FROM sessions WHERE workspace_id = $1',
    op: 'db',
    origin: 'auto.db.postgresjs',
    span_id: 'span_123',
    start_timestamp: 10,
    status: 'ok',
    timestamp: 10.125,
    trace_id: 'trace_123',
  };
}
