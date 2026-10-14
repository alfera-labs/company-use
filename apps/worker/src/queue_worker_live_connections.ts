import { create_logger } from '@coworker/shared';

export type QueueWorkerConnState =
  | { caller: 'server' }
  | { caller: 'browser'; user_id: string; exp: number };

export type LiveConnection = {
  state: QueueWorkerConnState;
  send(name: string, ...args: unknown[]): void;
  disconnect(reason?: string): Promise<void>;
};

const log = create_logger('queue_worker_live_connections');
export const expired_connection_check_interval_ms = 10_000;

export function is_server_connection(conn: { state: QueueWorkerConnState }) {
  return conn.state.caller === 'server';
}

export function send_to_live_connections(
  conns: Iterable<LiveConnection>,
  event: unknown,
  now: Date,
) {
  for (const conn of conns) {
    if (conn.state.caller !== 'browser') continue;
    if (ticket_has_expired(conn.state, now)) close_connection(conn);
    else conn.send('run_event', event);
  }
}

export function close_expired_connections(conns: Iterable<LiveConnection>, now: Date) {
  for (const conn of conns) {
    if (conn.state.caller === 'browser' && ticket_has_expired(conn.state, now)) {
      close_connection(conn);
    }
  }
}

function ticket_has_expired(state: { exp: number }, now: Date) {
  return state.exp * 1000 <= now.getTime();
}

function close_connection(conn: LiveConnection) {
  conn.disconnect('run_stream_ticket_expired').catch((error: unknown) => {
    log.warn('closing a live connection whose ticket expired failed; the next check tries again', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
