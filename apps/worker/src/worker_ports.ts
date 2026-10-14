import type { LiveEventPublisher } from '@coworker/jobs';
import {
  type LiveConnection,
  send_to_live_connections,
} from '@worker/queue_worker_live_connections';

export type WorkerPorts = {
  live_events: LiveEventPublisher;
  keep_awake: <T>(promise: Promise<T>) => Promise<T>;
};

type ActorContextForPorts = {
  conns: Map<string, LiveConnection>;
  keepAwake<T>(promise: Promise<T>): Promise<T>;
};

export function create_worker_ports(c: ActorContextForPorts, now: () => Date): WorkerPorts {
  return {
    live_events: { publish: (event) => send_to_live_connections(c.conns.values(), event, now()) },
    keep_awake: (promise) => c.keepAwake(promise),
  };
}
