import { automation_lifecycle } from '@api/services/automations/automation_lifecycle';
import { env, type RivetConnection, require_rivet_connection } from '@coworker/config';
import { configure_event_job_doorbell, configure_event_job_error_reporter } from '@coworker/jobs';
import { configure_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import { create_worker_clock_start, create_worker_doorbell } from '@worker/queue_worker_ring';
import { start_registration_watch } from '@worker/registration_watch';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import { start_repeating_task } from '@worker/repeating_task';
import { serve_rivet_over_http } from '@worker/serverless_http_server';
import { engine_origin, register_with_rivet } from '@worker/worker_registration';
import { capture_event_job_exception, capture_worker_exception } from '@worker/worker_sentry';
import { create_worker_services } from '@worker/worker_services';
import { createClient } from 'rivetkit/client';

const services = create_worker_services();

process.on('unhandledRejection', (error) => {
  services.log.error('unhandled rejection in the worker', {
    error: error instanceof Error ? error.message : String(error),
  });
  capture_worker_exception(error, { failure: 'unhandled_rejection' });
});
configure_event_job_error_reporter(capture_event_job_exception);
configure_automation_lifecycle(automation_lifecycle);

const connection = read_worker_connection();
const client = create_worker_client(connection);
configure_event_job_doorbell(create_worker_doorbell(client, services));
const create_registry = () => create_worker_registry(services, connection);

if (env.RIVETKIT_RUNTIME_MODE === 'serverless') {
  const registry = create_registry();
  serve_rivet_over_http({
    port: env.PORT,
    secret: env.WORKER_SERVERLESS_SECRET,
    handle: (request) => registry.handler(request),
  });
  services.log.info(
    `worker ready: serving Rivet over HTTP (serverless) on port ${env.PORT}, engine ${engine_origin(connection.endpoint)}`,
  );
} else {
  const registry = await register_with_rivet(services, create_registry);
  start_registration_watch(services, { registry, create_registry });
  services.log.info(`worker ready: registered with Rivet at ${engine_origin(connection.endpoint)}`);
  start_repeating_task(services, {
    task_name: 'clock start',
    interval_ms: 60_000,
    run: create_worker_clock_start(client, services),
  });
}

function read_worker_connection() {
  if (env.EVENT_JOB_DISPATCH_MODE !== 'rivet') {
    throw new Error(
      `The worker needs EVENT_JOB_DISPATCH_MODE=rivet, got ${env.EVENT_JOB_DISPATCH_MODE}.`,
    );
  }
  return require_rivet_connection();
}

function create_worker_client(rivet: RivetConnection) {
  return createClient<WorkerRegistry>({
    endpoint: rivet.endpoint,
    poolName: rivet.pool,
    ...(rivet.namespace ? { namespace: rivet.namespace } : {}),
    ...(rivet.token ? { token: rivet.token } : {}),
  });
}
