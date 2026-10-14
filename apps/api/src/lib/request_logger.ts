import type { ApiEnv } from '@api/lib/context';
import { count_database_statements } from '@coworker/core/db/database_statement_count';
import { create_logger, type Logger } from '@coworker/shared';
import type { MiddlewareHandler } from 'hono';

const http_log = create_logger('http');

const redacted_value = '[redacted]';

const sensitive_query_key_fragments = [
  'accesstoken',
  'apikey',
  'authorization',
  'authtoken',
  'clientsecret',
  'code',
  'credential',
  'password',
  'providerwebhooktoken',
  'refreshtoken',
  'secret',
  'signature',
  'state',
  'ticket',
  'token',
] as const;

export function request_logger(
  log: Pick<Logger, 'debug' | 'info'> = http_log,
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const method = c.req.method;
    const path = redacted_request_path(c.req.url);
    const request_id = c.get('requestId');
    log.debug('request started', { request_id, method, path });

    const start_time = Date.now();
    const { statement_count } = await count_database_statements(next);
    log.info('request completed', {
      request_id,
      method,
      path,
      status_code: c.res.status,
      duration_ms: Date.now() - start_time,
      database_statement_count: statement_count,
    });
  };
}

export function redacted_request_path(raw_url: string) {
  const url = redact_request_url(raw_url);
  return `${url.pathname}${url.search}`;
}

export function redacted_request_url(raw_url: string) {
  return redact_request_url(raw_url).toString();
}

const sensitive_path_segment_pattern = /^it_[A-Za-z0-9_-]{20,}$/;

function redact_request_url(raw_url: string) {
  const url = new URL(raw_url);
  for (const key of [...url.searchParams.keys()]) {
    if (is_sensitive_query_key(key)) {
      url.searchParams.set(key, redacted_value);
    }
  }
  url.pathname = url.pathname
    .split('/')
    .map((segment) => (sensitive_path_segment_pattern.test(segment) ? redacted_value : segment))
    .join('/');
  return url;
}

function is_sensitive_query_key(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return sensitive_query_key_fragments.some((fragment) => normalized.includes(fragment));
}
