import { read_api_sentry_config } from '@coworker/config';
import type { EventJobErrorContext } from '@coworker/jobs';
import { redact_credentials } from '@coworker/shared';
import * as Sentry from '@sentry/node';

let is_sentry_enabled = false;

export function initialize_worker_sentry() {
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
      Sentry.postgresIntegration(),
    ],
    initialScope: { tags: { service: 'worker' } },
    sendDefaultPii: false,
    beforeSend: (event) => redact_credentials(event) as typeof event,
    beforeSendLog: (log) => redact_credentials(log) as typeof log,
  });

  is_sentry_enabled = true;
}

export function capture_worker_exception(
  error: unknown,
  tags: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  if (!is_sentry_enabled) return;

  Sentry.captureException(error, { tags: { runtime: 'worker', ...tags }, extra });
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
