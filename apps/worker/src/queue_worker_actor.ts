import { drain_queue_jobs, type QueueRef, queue_worker_lock_prefix } from '@coworker/jobs';
import {
  cancel_run_here,
  create_connection_state,
  read_events_after,
  read_queue_ref,
} from '@worker/queue_worker_client_access';
import {
  close_expired_connections,
  expired_connection_check_interval_ms,
  is_server_connection,
  type LiveConnection,
} from '@worker/queue_worker_live_connections';
import { create_worker_ports, type WorkerPorts } from '@worker/worker_ports';
import { capture_worker_exception } from '@worker/worker_sentry';
import type { WorkerServices } from '@worker/worker_services';
import { actor, queue } from 'rivetkit';
import { z } from 'zod';

export const wake_message_schema = z.object({ job_id: z.string().min(1) }).strict();
export type WakeMessage = z.infer<typeof wake_message_schema>;

export function create_queue_worker_actor(services: WorkerServices) {
  return actor({
    queues: {
      wake: queue<WakeMessage>({
        message: wake_message_schema,
        canPublish: (c: { conn: LiveConnection }) => is_server_connection(c.conn),
      }),
    },
    createConnState: (c, params) =>
      create_connection_state(services, read_queue_ref(services, c.key), params),
    actions: {
      events_after: (c, body: unknown) =>
        read_events_after(services, read_queue_ref(services, c.key), body),
      cancel_run: (c, body: unknown) =>
        cancel_run_here(services, read_queue_ref(services, c.key), body),
    },
    run: async (c) => {
      const queue_ref = read_own_queue_ref(services, c.key);
      if (!queue_ref) return;
      const ports = create_worker_ports(c, services.now);
      const worker_id_prefix = `${queue_worker_lock_prefix}${c.actorId}`;
      const drain = () => drain_queue(services, ports, { ...queue_ref, worker_id_prefix });
      const expiry_check = setInterval(
        () => close_expired_connections(c.conns.values(), services.now()),
        expired_connection_check_interval_ms,
      );
      try {
        await drain();
        const wakes = c.queue.iter({ names: ['wake'], signal: c.abortSignal });
        for await (const _drained of drain_after_each_wake(wakes, drain)) {
        }
      } finally {
        clearInterval(expiry_check);
      }
    },
  });
}

async function* drain_after_each_wake(wakes: AsyncIterable<unknown>, drain: () => Promise<void>) {
  for await (const _wake of wakes) yield drain();
}

async function drain_queue(
  services: WorkerServices,
  ports: WorkerPorts,
  input: QueueRef & { worker_id_prefix: string },
) {
  try {
    const job_ids = await ports.keep_awake(
      drain_queue_jobs(
        services.db,
        { ...input, live_events: ports.live_events },
        services.find_event_job_handler,
      ),
    );
    if (job_ids.length > 0) {
      services.log.info(
        `queue worker ran ${job_ids.length} job(s) for ${input.queue_key} (${input.workspace_id}): ${job_ids.join(', ')}`,
      );
    }
  } catch (error) {
    services.log.error('queue worker drain failed; the recovery sweep will ring again', {
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      error: error instanceof Error ? error.message : String(error),
    });
    capture_worker_exception(
      error,
      { failure: 'queue_drain', workspace_id: input.workspace_id },
      { queue_key: input.queue_key },
    );
  }
}

function read_own_queue_ref(services: WorkerServices, key: string[]): QueueRef | null {
  try {
    return read_queue_ref(services, key);
  } catch (error) {
    services.log.error('a queue worker with a key this worker does not serve drains nothing', {
      key: JSON.stringify(key),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
