import type { ApiEnv } from '@api/lib/context';
import {
  read_stream_cursor,
  request_wants_live_run_events,
} from '@api/routes/live_run_event_request';
import { read_run_or_raise } from '@api/routes/sessions/session_reader';
import { get_run, list_run_events } from '@coworker/core/db/queries/sessions';
import { read_run_events } from '@coworker/runtime-platform';
import { NotFoundError, run_event_row_to_live_event } from '@coworker/shared';
import { public_run_event } from '@runtime-platform/chat_stream/public_run_output';
import { Hono } from 'hono';

const time_between_checks_for_new_events_ms = 750;
const keep_alive_interval_ms = 15_000;
const replay_batch_size = 100;
const stream_backpressure_check_interval_ms = 10;

const finished_run_statuses = new Set(['completed', 'failed', 'cancelled']);

const encoder = new TextEncoder();

type LiveRunEventStreamInput = {
  db: ApiEnv['Variables']['db'];
  workspace_id: string;
  run_id: string;
  cursor: number;
  signal: AbortSignal;
};

export const live_run_event_routes = new Hono<ApiEnv>().get(
  '/v1/runs/:run_id/events',
  async (c, next) => {
    if (!request_wants_live_run_events(c.req.raw)) {
      await next();
      return;
    }

    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const run_id = c.req.param('run_id');
    await read_run_or_raise(c, run_id);

    return new Response(
      create_live_run_event_stream({
        db,
        workspace_id,
        run_id,
        cursor: read_stream_cursor(
          c.req.raw,
          c.req.query('after_event_sequence'),
          c.req.query('cursor'),
        ),
        signal: c.req.raw.signal,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      },
    );
  },
);

function create_live_run_event_stream(input: LiveRunEventStreamInput) {
  const stream_lifetime = new AbortController();
  let consumer_cancelled = false;
  const stop_for_request_abort = () => stream_lifetime.abort();
  if (input.signal.aborted) stream_lifetime.abort();
  else input.signal.addEventListener('abort', stop_for_request_abort, { once: true });
  const stream_input = { ...input, signal: stream_lifetime.signal };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = stream_input.cursor;
      let run_was_finished_on_last_check = false;
      let end_event_was_sent = false;
      let drained_once_after_end_event = false;
      let next_keep_alive_time = Date.now() + keep_alive_interval_ms;

      try {
        while (!stream_input.signal.aborted) {
          const sent = await send_new_run_events(controller, stream_input, cursor);
          cursor = sent.cursor;
          if (sent.saw_end_event) end_event_was_sent = true;
          if (stream_input.signal.aborted) break;

          if (sent.event_count === replay_batch_size) {
            await wait_for_stream_demand(controller, stream_input.signal);
            continue;
          }

          if (end_event_was_sent) {
            if (drained_once_after_end_event) {
              controller.enqueue(
                encoder.encode(format_sse_event('stream_end', { reason: 'end_event' })),
              );
              controller.close();
              return;
            }

            drained_once_after_end_event = true;
          } else if (
            await run_is_finished(stream_input.db, stream_input.workspace_id, stream_input.run_id)
          ) {
            if (stream_input.signal.aborted) break;
            if (run_was_finished_on_last_check) {
              controller.enqueue(
                encoder.encode(
                  format_sse_event('stream_end', { reason: 'run_terminal_without_end_event' }),
                ),
              );
              controller.close();
              return;
            }

            run_was_finished_on_last_check = true;
          } else {
            run_was_finished_on_last_check = false;
          }

          if (Date.now() >= next_keep_alive_time) {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
            next_keep_alive_time = Date.now() + keep_alive_interval_ms;
          }

          await wait_before_next_check(stream_input.signal);
        }

        if (!consumer_cancelled) controller.close();
      } finally {
        input.signal.removeEventListener('abort', stop_for_request_abort);
      }
    },
    cancel() {
      consumer_cancelled = true;
      stream_lifetime.abort();
      input.signal.removeEventListener('abort', stop_for_request_abort);
    },
  });
}

async function send_new_run_events(
  controller: ReadableStreamDefaultController<Uint8Array>,
  input: LiveRunEventStreamInput,
  cursor: number,
) {
  const rows = await read_run_events(input.db, {
    workspace_id: input.workspace_id,
    rows: await list_run_events(input.db, input.workspace_id, input.run_id, {
      after_sequence: cursor,
      limit: replay_batch_size,
    }),
    payload_reading: 'load_full_value',
  });

  for (const row of rows) {
    await wait_for_stream_demand(controller, input.signal);
    if (input.signal.aborted) return { cursor, saw_end_event: false, event_count: 0 };
    cursor = row.event_sequence;
    controller.enqueue(
      encoder.encode(
        format_sse_event(
          'run_event',
          run_event_row_to_live_event(public_run_event(row)),
          String(row.event_sequence),
        ),
      ),
    );

    if (row.event_type === 'end') {
      return { cursor, saw_end_event: true, event_count: rows.length };
    }
  }

  return { cursor, saw_end_event: false, event_count: rows.length };
}

async function run_is_finished(
  db: LiveRunEventStreamInput['db'],
  workspace_id: string,
  run_id: string,
) {
  const run = await get_run(db, workspace_id, run_id);
  if (!run) throw new NotFoundError('Run');

  return finished_run_statuses.has(run.run_status);
}

function format_sse_event(event_name: string, data: unknown, id?: string) {
  const id_line = id ? `id: ${id}\n` : '';
  return `${id_line}event: ${event_name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function wait_before_next_check(signal: AbortSignal) {
  return wait_for_milliseconds(signal, time_between_checks_for_new_events_ms);
}

async function wait_for_stream_demand(
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal,
) {
  while (!signal.aborted && controller.desiredSize !== null && controller.desiredSize <= 0) {
    await wait_for_milliseconds(signal, stream_backpressure_check_interval_ms);
  }
}

function wait_for_milliseconds(signal: AbortSignal, milliseconds: number) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}
