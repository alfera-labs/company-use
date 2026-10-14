import {
  type CancelRunResult,
  create_rivet_actor_lookup,
} from '@api/services/events/rivet_actor_lookup';
import { env, type RivetConnection, require_rivet_connection } from '@coworker/config';
import {
  build_queue_worker_key,
  type QueueRef,
  type QueueWorkerKey,
  uses_rivet_event_job_dispatch,
} from '@coworker/jobs';
import { give_up_after } from '@coworker/shared';
import { sign_queue_worker_control } from '@runtime-platform/orchestrator/queue_worker_control';

export type QueueWorkerClient = {
  key_scope: string;
  create_queue_worker(queue: QueueRef): Promise<QueueWorkerKey>;
  cancel_run(queue: QueueRef, run_id: string): Promise<CancelRunResult>;
};

const cancel_run_timeout_ms = 2_000;
const create_queue_worker_timeout_ms = 3_000;
const engine_did_not_answer = 'The Rivet engine';
let cached: { connection_key: string; client: QueueWorkerClient } | undefined;

export function get_queue_worker_client(): QueueWorkerClient | null {
  if (!uses_rivet_event_job_dispatch()) return null;
  const connection = require_rivet_connection(env);
  const connection_key = JSON.stringify(connection);
  if (cached?.connection_key !== connection_key) {
    cached = { connection_key, client: create_queue_worker_client(connection) };
  }
  return cached.client;
}

function create_queue_worker_client(connection: RivetConnection): QueueWorkerClient {
  const lookup = create_rivet_actor_lookup(connection);
  const create_options = connection.region ? { createInRegion: connection.region } : undefined;
  const key_scope = connection.pool;
  return {
    key_scope,
    create_queue_worker: async (queue) => {
      const key = build_queue_worker_key(key_scope, queue);
      await give_up_after(
        lookup.queue_worker.get_or_create(key, create_options).resolve(),
        create_queue_worker_timeout_ms,
        engine_did_not_answer,
      );
      return key;
    },
    cancel_run: (queue, run_id) => {
      const api_signature = sign_queue_worker_control({ key_scope, ...queue, run_id });
      const key = build_queue_worker_key(key_scope, queue);
      return give_up_after(
        lookup.queue_worker
          .get(key, { params: { api_signature } })
          .cancel_run({ run_id, api_signature }, AbortSignal.timeout(cancel_run_timeout_ms)),
        cancel_run_timeout_ms,
        engine_did_not_answer,
      );
    },
  };
}
