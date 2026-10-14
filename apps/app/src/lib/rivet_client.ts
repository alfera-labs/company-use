import { createClient } from 'rivetkit/client';
import type { ChatStreamEvent, Run, SessionStreamTicket } from '@/lib/api/types';

const reopen_grace_ms = 3_000;

export type LiveRunEvent =
  | { type: 'run_created' | 'run_updated'; run: Run }
  | { type: 'message_created'; message: { run_id: string } }
  | { type: 'chat_event'; event: ChatStreamEvent };

export type SessionLiveSocket = {
  events_after: (input: { run_id: string; after_sequence: number }) => Promise<ChatStreamEvent[]>;
  close: () => void;
};

type RivetClient = ReturnType<typeof createClient>;
type EventsAfterBody = { ticket: string; run_id: string; after_sequence: number };

export function open_session_live_socket(
  ticket: SessionStreamTicket,
  handlers: {
    on_run_event: (event: LiveRunEvent) => void;
    on_open: () => void;
    on_lost: (reason: string) => void;
  },
): SessionLiveSocket {
  const client = createClient({
    endpoint: ticket.rivet_endpoint,
    ...(ticket.rivet_namespace ? { namespace: ticket.rivet_namespace } : {}),
    ...(ticket.rivet_token ? { token: ticket.rivet_token } : {}),
  });
  const connection = read_queue_worker(client)
    .get(ticket.actor_key)
    .connect({ ticket: ticket.ticket });
  let reopen_timer: ReturnType<typeof setTimeout> | undefined;
  let is_closed = false;
  const report_lost = (reason: string) => {
    if (is_closed) return;
    handlers.on_lost(reason);
  };

  connection.on('run_event', handlers.on_run_event);
  connection.onOpen(() => {
    clearTimeout(reopen_timer);
    handlers.on_open();
  });
  connection.onClose(() => {
    clearTimeout(reopen_timer);
    reopen_timer = setTimeout(() => report_lost('closed and not reopened in 3 s'), reopen_grace_ms);
  });
  connection.onError((error) => report_lost(describe_error(error)));

  return {
    events_after: (input) =>
      connection.action<[EventsAfterBody], ChatStreamEvent[]>({
        name: 'events_after',
        args: [{ ticket: ticket.ticket, ...input }],
      }),
    close: () => {
      is_closed = true;
      clearTimeout(reopen_timer);
      void connection.dispose().finally(() => client.dispose());
    },
  };
}

function read_queue_worker(client: RivetClient) {
  const accessor = client.queue_worker;
  if (!accessor) throw new Error('The Rivet client has no queue_worker actor.');
  return accessor;
}

function describe_error(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) return `error ${String(error.code)}`;
  return error instanceof Error ? error.message : String(error);
}
