import {
  build_queue_worker_key,
  type ClockLookup,
  create_clock_start,
  type Doorbell,
  destroy_actor_if_parked,
  ring_time_limit_ms,
} from '@coworker/jobs';
import { give_up_after } from '@coworker/shared';
import { sign_queue_worker_control } from '@runtime-platform/orchestrator/queue_worker_control';
import type { WakeMessage } from '@worker/queue_worker_actor';
import type { WorkerServices } from '@worker/worker_services';

export type QueueRing = { workspace_id: string; queue_key: string; job_id: string };
export type RingQueueWorker = (ring: QueueRing) => Promise<void>;

type QueueWorkerHandle = {
  send(name: 'wake', body: WakeMessage, options: { signal: AbortSignal }): Promise<void>;
  resolve(): Promise<string>;
};

export type QueueWorkerLookup = {
  queue_worker: {
    getOrCreate(
      key: string[],
      options: { createInRegion?: string; params: { api_signature: string } },
    ): QueueWorkerHandle;
  };
};

export function create_queue_worker_ring(
  client: QueueWorkerLookup,
  services: Pick<WorkerServices, 'rivet_region' | 'rivet_key_scope' | 'rivet_engine'>,
): RingQueueWorker {
  const region_option = services.rivet_region ? { createInRegion: services.rivet_region } : {};
  const key_scope = services.rivet_key_scope;
  return async (ring) => {
    const find_queue_worker = () =>
      client.queue_worker.getOrCreate(build_queue_worker_key(key_scope, ring), {
        ...region_option,
        params: { api_signature: sign_queue_worker_control({ key_scope, ...ring }) },
      });
    try {
      await send_wake(find_queue_worker(), ring);
    } catch (error) {
      if (!(await destroy_actor_if_parked(services.rivet_engine, find_queue_worker()))) throw error;
      await send_wake(find_queue_worker(), ring);
    }
  };
}

function send_wake(queue_worker: QueueWorkerHandle, ring: QueueRing) {
  return give_up_after(
    queue_worker.send(
      'wake',
      { job_id: ring.job_id },
      { signal: AbortSignal.timeout(ring_time_limit_ms) },
    ),
    ring_time_limit_ms,
    'The Rivet engine',
  );
}

export function create_worker_doorbell(
  client: QueueWorkerLookup & ClockLookup,
  services: WorkerServices,
): Doorbell {
  const ring_queue_worker = create_queue_worker_ring(client, services);
  return {
    arm_clock: create_worker_clock_start(client, services),
    ring(input) {
      const [job_id] = input.job_ids;
      if (!job_id) return;
      return ring_queue_worker({
        workspace_id: input.workspace_id,
        queue_key: input.queue_key,
        job_id,
      });
    },
  };
}

export function create_worker_clock_start(client: ClockLookup, services: WorkerServices) {
  return create_clock_start(client, {
    key_scope: services.rivet_key_scope,
    region: services.rivet_region,
    engine: services.rivet_engine,
  });
}
