import type { ApiEnv } from '@api/lib/context';
import { redacted_request_url } from '@api/lib/request_logger';
import { log_sentry_database_span } from '@api/lib/sentry_span_logger';
import { read_api_sentry_config } from '@coworker/config';
import type { EventJobErrorContext } from '@coworker/jobs';
import { redact_credentials } from '@coworker/shared';
import * as Sentry from '@sentry/node';
import type { Context } from 'hono';

let is_sentry_enabled = false;

export function initialize_api_sentry() {
  const sentry_config = read_api_sentry_config();

  if (!sentry_config || is_sentry_enabled) return;

  Sentry.init({
    dsn: sentry_config.dsn,
    environment: sentry_config.environment,
    release: sentry_config.release,
    tracesSampleRate: sentry_config.traces_sample_rate ?? 0.1,
    enableLogs: true,
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ['error'] }),
      Sentry.honoIntegration(),
      Sentry.postgresIntegration(),
    ],
    sendDefaultPii: false,
    beforeSend: remove_credentials_from_sentry_event,
    // Console output is shipped separately from exceptions, so it needs its own scrub or a key
    // logged by a dependency reaches Sentry without ever passing through `beforeSend`.
    beforeSendLog: remove_credentials_from_sentry_log,
    beforeSendSpan: log_sentry_database_span,
  });

  is_sentry_enabled = true;
}

export function capture_unhandled_exception(error: unknown) {
  if (!is_sentry_enabled) return;

  Sentry.captureException(error, { tags: { runtime: 'api' } });
}

export function capture_event_job_exception(error: unknown, context: EventJobErrorContext) {
  if (!is_sentry_enabled) return;

  Sentry.captureException(error, {
    tags: {
      runtime: 'event_job',
      workspace_id: context.workspace_id,
      job_handler: context.job_handler,
      ...(context.error_code ? { error_code: context.error_code } : {}),
      ...(context.safe_tags ?? {}),
    },
    extra: {
      queue_key: context.queue_key,
      job_ids: context.job_ids,
      run_ids: context.run_ids,
    },
  });
}

export function capture_api_exception(error: unknown, c: Context<ApiEnv>) {
  if (!is_sentry_enabled) return;

  Sentry.withScope((scope) => {
    scope.setTag('runtime', 'api');
    scope.setTag('method', c.req.method);
    scope.setTag('path', c.req.path);
    scope.setTag('http.status_code', '500');
    scope.setTag('http.method', c.req.method);
    scope.setTag('http.route', c.req.path);

    const workspace_id = read_context_value(c, 'workspace_id');
    const agent_id = read_context_value(c, 'agent_id');
    const user_id = read_context_value(c, 'user_id');
    const request_id = read_context_value(c, 'requestId');

    if (workspace_id) scope.setTag('workspace_id', workspace_id);
    if (agent_id) scope.setTag('agent_id', agent_id);
    if (request_id) scope.setTag('request_id', request_id);
    if (user_id) scope.setUser({ id: user_id });

    Sentry.captureException(error, {
      mechanism: { type: 'hono.on_error', handled: false },
    });
  });
}

function read_context_value(
  c: Context<ApiEnv>,
  key: 'workspace_id' | 'agent_id' | 'user_id' | 'requestId',
): string | undefined {
  try {
    if (key === 'requestId') return c.get(key);
    return c.get(key);
  } catch {
    return undefined;
  }
}

function remove_credentials_from_sentry_event<T extends SentryEventWithRequestHeaders>(event: T) {
  remove_secret_headers(event.request?.headers);
  if (event.request?.url) event.request.url = redacted_request_url(event.request.url);
  return redact_credentials(event) as T;
}

function remove_credentials_from_sentry_log<T extends { message: string }>(log: T) {
  return redact_credentials(log) as T;
}

type SentryEventWithRequestHeaders = {
  request?: {
    headers?: Record<string, unknown>;
    url?: string;
  };
};

const secret_header_names = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'x-coworker-api-secret',
]);

function remove_secret_headers(headers: Record<string, unknown> | undefined) {
  if (!headers) return;

  for (const key of Object.keys(headers)) {
    if (secret_header_names.has(key.toLowerCase())) delete headers[key];
  }
}
