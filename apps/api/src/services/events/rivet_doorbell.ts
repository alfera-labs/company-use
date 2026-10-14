import { create_rivet_actor_lookup } from '@api/services/events/rivet_actor_lookup';
import type { RivetConnection } from '@coworker/config';
import {
  build_queue_worker_key,
  create_clock_start,
  type Doorbell,
  ring_time_limit_ms,
} from '@coworker/jobs';
import { give_up_after } from '@coworker/shared';
import { sign_queue_worker_control } from '@runtime-platform/orchestrator/queue_worker_control';

export function create_rivet_doorbell(connection: RivetConnection): Doorbell {
  const lookup = create_rivet_actor_lookup(connection);
  const region = connection.region ? { createInRegion: connection.region } : {};
  return {
    arm_clock: create_rivet_clock_start(connection),
    ring(input) {
      const [job_id] = input.job_ids;
      if (!job_id) return;
      const queue = { workspace_id: input.workspace_id, queue_key: input.queue_key };
      const api_signature = sign_queue_worker_control({ key_scope: connection.pool, ...queue });
      return give_up_after(
        lookup.queue_worker
          .get_or_create(build_queue_worker_key(connection.pool, queue), {
            ...region,
            params: { api_signature },
          })
          .wake({ job_id }, AbortSignal.timeout(ring_time_limit_ms)),
        ring_time_limit_ms,
        'The Rivet engine',
      );
    },
  };
}

export function create_rivet_clock_start(connection: RivetConnection) {
  return create_clock_start(create_rivet_actor_lookup(connection), {
    key_scope: connection.pool,
    region: connection.region,
    engine: connection,
  });
}
