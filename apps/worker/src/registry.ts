import { env, type RivetConnection } from '@coworker/config';
import {
  configure_max_concurrent_queue_runs,
  mark_this_process_as_queue_worker,
} from '@coworker/jobs';
import { create_clock_actor } from '@worker/clock_actor';
import { create_queue_worker_actor } from '@worker/queue_worker_actor';
import { retired_scheduler_actor } from '@worker/scheduler_actor';
import type { WorkerServices } from '@worker/worker_services';
import { setup } from 'rivetkit';

export function create_worker_registry(services: WorkerServices, connection: RivetConnection) {
  configure_max_concurrent_queue_runs(env.QUEUE_WORKER_MAX_CONCURRENT_RUNS);
  mark_this_process_as_queue_worker();
  return setup({
    use: {
      queue_worker: create_queue_worker_actor(services),
      clock: create_clock_actor(services),
      scheduler: retired_scheduler_actor,
    },
    endpoint: connection.endpoint,
    envoy: { poolName: connection.pool },
    ...(connection.namespace ? { namespace: connection.namespace } : {}),
    ...(connection.token ? { token: connection.token } : {}),
    startEngine: false,
    startServices: false,
    noWelcome: true,
    shutdown: { gracePeriodMs: 10_000 },
  });
}

export type WorkerRegistry = ReturnType<typeof create_worker_registry>;
