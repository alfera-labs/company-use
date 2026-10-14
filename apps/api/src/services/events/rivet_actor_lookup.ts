import type { RivetConnection } from '@coworker/config';
import type { ClockLookup } from '@coworker/jobs';
import { ActorHandleRaw, createClient } from 'rivetkit/client';

type RivetClient = ReturnType<typeof createClient>;
type RivetActorHandle = ReturnType<RivetClient['get']>;
type QueueWorkerOptions = { createInRegion?: string; params?: { api_signature: string } };

export type CancelRunResult = { stopping: boolean; was_running_here: boolean };
export type CancelRunBody = { run_id: string; api_signature: string };

export type QueueWorkerHandle = {
  resolve(): Promise<string>;
  wake(body: { job_id: string }, signal: AbortSignal): Promise<void>;
  cancel_run(body: CancelRunBody, signal: AbortSignal): Promise<CancelRunResult>;
};

/** Typed view of the rivetkit client: the queue worker and the clock actor, nothing else. */
export type RivetActorLookup = ClockLookup & {
  queue_worker: {
    get_or_create(key: string[], options?: QueueWorkerOptions): QueueWorkerHandle;
    get(key: string[], options?: QueueWorkerOptions): QueueWorkerHandle;
  };
};

/** Opens a rivetkit client for the connection and returns the typed actor lookup. */
export function create_rivet_actor_lookup(connection: RivetConnection): RivetActorLookup {
  const client = createClient({
    endpoint: connection.endpoint,
    poolName: connection.pool,
    ...(connection.namespace ? { namespace: connection.namespace } : {}),
    ...(connection.token ? { token: connection.token } : {}),
  });
  return {
    queue_worker: {
      get_or_create: (key, options) =>
        to_queue_worker_handle(client.getOrCreate('queue_worker', key, options)),
      get: (key, options) => to_queue_worker_handle(client.get('queue_worker', key, options)),
    },
    clock: {
      getOrCreate: (key, options) => {
        const handle = client.getOrCreate('clock', key, options);
        return {
          arm: (wake_by_ms) => handle.action({ name: 'arm', args: [wake_by_ms] }),
          resolve: () => handle.resolve(),
        };
      },
    },
  };
}

function to_queue_worker_handle(handle: RivetActorHandle): QueueWorkerHandle {
  return {
    resolve: () => handle.resolve(),
    wake: (body, signal) => read_raw_handle(handle).send('wake', body, { signal }),
    cancel_run: (body, signal) =>
      handle.action<[CancelRunBody], CancelRunResult>({ name: 'cancel_run', args: [body], signal }),
  };
}

function read_raw_handle(handle: RivetActorHandle): ActorHandleRaw {
  if (handle instanceof ActorHandleRaw) return handle;
  throw new Error('The Rivet client returned a queue worker handle without a queue.');
}
