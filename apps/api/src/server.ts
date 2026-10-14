import { create_app } from '@api/app';
import { is_abort_error } from '@api/lib/abort_error';
import { report_unhandled_process_error } from '@api/lib/process_error_policy';
import { capture_event_job_exception, capture_unhandled_exception } from '@api/lib/sentry';
import { validate_api_startup_config } from '@api/lib/startup_config';
import { create_api_shutdown } from '@api/services/api_shutdown';
import { automation_lifecycle } from '@api/services/automations/automation_lifecycle';
import { wait_for_event_job_requests_to_finish } from '@api/services/events/event_job_requests';
import {
  create_rivet_clock_start,
  create_rivet_doorbell,
} from '@api/services/events/rivet_doorbell';
import { provision_missing_workspace_triggers } from '@api/services/provisioning/workspace_trigger_reconcile';
import { env, product_brand_config, require_rivet_connection } from '@coworker/config';
import { get_database } from '@coworker/core';
import {
  configure_event_job_doorbell,
  configure_event_job_error_reporter,
  uses_rivet_event_job_dispatch,
} from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { serve } from '@hono/node-server';
import { configure_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';

const log = create_logger('api');

validate_api_startup_config(env);
configure_event_job_error_reporter(capture_event_job_exception);
configure_automation_lifecycle(automation_lifecycle);
if (uses_rivet_event_job_dispatch()) {
  configure_event_job_doorbell(create_rivet_doorbell(require_rivet_connection()));
}

const unhandled_error_handlers = {
  is_abort_error,
  report: capture_unhandled_exception,
  log_warn: (message: string, error: unknown) => log.warn(message, error),
  log_error: (error: unknown) => log.error('unhandled process error', error),
};
process.on('uncaughtException', (error) => {
  const decision = report_unhandled_process_error(
    error,
    'uncaught_exception',
    unhandled_error_handlers,
  );
  if (decision === 'reported_exit') process.exit(1);
});
process.on('unhandledRejection', (error) => {
  report_unhandled_process_error(error, 'unhandled_rejection', unhandled_error_handlers);
});

const app = create_app(get_database());

// Cloud Run and portless both inject the reserved PORT (and portless also HOST); fall back to
// the configured API_PORT for plain local dev. Bind 0.0.0.0 so Cloud Run can reach the container.
const port = env.PORT ?? env.API_PORT;
const hostname = env.HOST;

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  log.info(
    `${product_brand_config.product_brand_name} API listening on http://${hostname}:${info.port}`,
  );

  if (uses_rivet_event_job_dispatch()) {
    void create_rivet_clock_start(require_rivet_connection())().then(() =>
      log.info('event jobs run on Rivet queue workers; this API runs none'),
    );
  }

  provision_missing_workspace_triggers(get_database())
    .then((result) =>
      log.info(
        `workspace trigger boot sweep: checked ${result.workspaces_checked}, reconciled ${result.workspaces_reconciled}`,
      ),
    )
    .catch((error) => log.error('workspace trigger boot sweep failed', error));
});

const shutdown = create_api_shutdown({
  close_server: (finished) => server.close(finished),
  wait_for_event_job_requests: wait_for_event_job_requests_to_finish,
  exit_process: (code) => process.exit(code),
});

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
