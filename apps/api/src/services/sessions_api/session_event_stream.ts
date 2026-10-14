import { api_key_is_still_live, sleep_unless_aborted } from '@api/lib/api_key_long_poll';
import { capture_unhandled_exception } from '@api/lib/sentry';
import type { PublicSessionEvent } from '@api/services/sessions_api/public_session_events';
import { read_session_events } from '@api/services/sessions_api/session_event_reads';
import { require_owned_api_session } from '@api/services/sessions_api/session_reads';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { create_logger, NotFoundError } from '@coworker/shared';

const log = create_logger('session_event_stream');

const stream_batch_size = 100;
const time_between_checks_for_new_events_ms = 750;
const keep_alive_interval_ms = 15_000;
const stream_backpressure_check_interval_ms = 10;

// A fixed 5 minutes. A held stream costs three reads every 750ms; capping its life bounds
// what one forgotten client can spend, and the reconnect it forces costs one request.
export const max_session_event_stream_lifetime_ms = 5 * 60_000;

const stream_endings = {
  lifetime_reached: ': stream lifetime reached; reconnect with Last-Event-ID to resume\n\n',
  api_key_not_live: ': this API key was revoked or expired; stream closed\n\n',
  read_failed: ': stream failed; reconnect with Last-Event-ID to resume\n\n',
} as const;

const encoder = new TextEncoder();

export type SessionEventStreamInput = {
  db: Database;
  api_key: ApiKey;
  session_id: string;
  after_event_id: string | undefined;
  signal: AbortSignal;
  on_close: () => void;
};

const lifetime_reached = 'lifetime_reached';
const client_left = 'client_left';

export function create_session_event_stream(input: SessionEventStreamInput) {
  const stream_lifetime = new AbortController();
  const stop_for_request_abort = () => stream_lifetime.abort(client_left);
  if (input.signal.aborted) stream_lifetime.abort(client_left);
  else input.signal.addEventListener('abort', stop_for_request_abort, { once: true });
  const lifetime_timer = setTimeout(
    () => stream_lifetime.abort(lifetime_reached),
    max_session_event_stream_lifetime_ms,
  );
  const stop_stream = () => {
    clearTimeout(lifetime_timer);
    stream_lifetime.abort(client_left);
    input.signal.removeEventListener('abort', stop_for_request_abort);
    input.on_close();
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const ending = await send_session_events_until_stopped(
          controller,
          input,
          stream_lifetime.signal,
        );
        if (ending) controller.enqueue(encoder.encode(stream_endings[ending]));
      } catch (error) {
        log.error('session event stream failed', {
          workspace_id: input.api_key.workspace_id,
          api_key_id: input.api_key.api_key_id,
          session_id: input.session_id,
          error,
        });
        capture_unhandled_exception(error);
        if (!stream_lifetime.signal.aborted) {
          controller.enqueue(encoder.encode(stream_endings.read_failed));
        }
      } finally {
        stop_stream();
        close_quietly(controller);
      }
    },
    cancel() {
      stop_stream();
    },
  });
}

type StreamEnding = keyof typeof stream_endings | null;

async function send_session_events_until_stopped(
  controller: ReadableStreamDefaultController<Uint8Array>,
  input: SessionEventStreamInput,
  signal: AbortSignal,
): Promise<StreamEnding> {
  let cursor = input.after_event_id;
  let next_keep_alive_time = Date.now() + keep_alive_interval_ms;
  while (!signal.aborted) {
    if (!(await api_key_is_still_live(input.db, input.api_key))) return 'api_key_not_live';
    const sent = await send_new_session_events(controller, input, cursor, signal);
    cursor = sent.cursor;
    if (signal.aborted) break;
    if (sent.session_is_archived) return null;
    if (sent.has_more) continue;
    if (Date.now() >= next_keep_alive_time) {
      controller.enqueue(encoder.encode(': keep-alive\n\n'));
      next_keep_alive_time = Date.now() + keep_alive_interval_ms;
    }
    await sleep_unless_aborted(signal, time_between_checks_for_new_events_ms);
  }
  return signal.reason === lifetime_reached ? 'lifetime_reached' : null;
}

async function send_new_session_events(
  controller: ReadableStreamDefaultController<Uint8Array>,
  input: SessionEventStreamInput,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const session = await read_session_if_still_there(input);
  if (!session) return { cursor, has_more: false, session_is_archived: true };

  const page = await read_session_events(input.db, {
    workspace_id: input.api_key.workspace_id,
    session,
    after_event_id: cursor,
    limit: stream_batch_size,
  });

  let sent_terminated = false;
  for (const event of page.data) {
    await wait_for_stream_demand(controller, signal);
    if (signal.aborted) return { cursor, has_more: false, session_is_archived: false };
    cursor = event.id;
    sent_terminated ||= event.type === 'session.status_terminated';
    controller.enqueue(encoder.encode(format_sse_event(event)));
  }
  return { cursor, has_more: page.has_more, session_is_archived: sent_terminated };
}

async function read_session_if_still_there(input: SessionEventStreamInput) {
  try {
    return await require_owned_api_session(input.db, input.api_key, input.session_id);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

function format_sse_event(event: PublicSessionEvent) {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function wait_for_stream_demand(
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal,
) {
  while (!signal.aborted && controller.desiredSize !== null && controller.desiredSize <= 0) {
    await sleep_unless_aborted(signal, stream_backpressure_check_interval_ms);
  }
}

// A client that already hung up has cancelled the stream, and closing a cancelled stream throws.
function close_quietly(controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    controller.close();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
}
