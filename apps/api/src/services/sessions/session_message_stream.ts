import { check_again, repeat_until_done } from '@api/services/sessions/repeat_until_done';
import { read_session_message_outcome } from '@api/services/sessions/session_message_outcome';
import type { Database } from '@coworker/core';
import { find_session_message_job } from '@coworker/core/db/queries/session_message_queue';
import { list_run_chat_event_page } from '@coworker/core/db/queries/session_read_pages';
import { get_run, list_run_messages } from '@coworker/core/db/queries/sessions';
import { read_run_events, run_event_row_to_chat_stream_event } from '@coworker/runtime-platform';
import { AppError, NotFoundError } from '@coworker/shared';
import {
  public_chat_stream_event,
  public_run,
  public_run_failure_message,
} from '@runtime-platform/chat_stream/public_run_output';
import { public_session_message } from '@runtime-platform/chat_stream/public_session_reads';

const check_interval_ms = 500;
const keepalive_interval_ms = 15_000;
const run_end_statuses = new Set([
  'completed',
  'failed',
  'cancelled',
  'waiting',
  'blocked',
  'timed_out',
]);

type StreamInput = { workspace_id: string; session_id: string; job_id: string };
type Writer = {
  send: (event_name: string, data: unknown, id?: string) => void;
  comment: (text: string) => void;
  signal: AbortSignal;
};

export function create_session_message_stream(
  db: Database,
  input: StreamInput,
  signal: AbortSignal,
) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer: Writer = {
        send: (event_name, data, id) =>
          controller.enqueue(encoder.encode(sse_frame(event_name, data, id))),
        comment: (text) => controller.enqueue(encoder.encode(`: ${text}\n\n`)),
        signal,
      };
      try {
        await stream_queued_message(db, input, writer);
      } catch (error) {
        writer.send('error', stream_error(error));
      } finally {
        controller.close();
      }
    },
  });
}

async function stream_queued_message(db: Database, input: StreamInput, writer: Writer) {
  writer.send('queued', { job_id: input.job_id, session_id: input.session_id });
  const run_id = await wait_for_run_to_start(db, input, writer);
  if (!run_id) return;
  const run_status = await tail_run(db, { ...input, run_id }, writer);
  if (run_status === 'failed') {
    writer.send('error', { code: 'stream_error', message: public_run_failure_message });
    return;
  }
  writer.send('done', { ok: true });
}

function wait_for_run_to_start(db: Database, input: StreamInput, writer: Writer) {
  let next_keepalive_time = Date.now() + keepalive_interval_ms;
  return repeat_until_done<string | null>(async () => {
    if (writer.signal.aborted) return { done: true, value: null };
    const job = await find_session_message_job(db, input);
    if (!job) throw new NotFoundError('Queued message');
    const outcome = read_session_message_outcome(job);
    if (outcome.kind === 'refused') throw outcome.error;
    if (outcome.run_id) return { done: true, value: outcome.run_id };
    if (Date.now() >= next_keepalive_time) {
      writer.comment('keepalive');
      next_keepalive_time = Date.now() + keepalive_interval_ms;
    }
    return check_again;
  }, check_interval_ms);
}

function tail_run(db: Database, input: StreamInput & { run_id: string }, writer: Writer) {
  const cursor: RunCursor = {
    chat_sequence: 0,
    sent_message_ids: new Set<string>(),
    run_status: '',
    updated_status: '',
  };
  let finished_checks = 0;
  return repeat_until_done<string>(async () => {
    if (writer.signal.aborted) return { done: true, value: cursor.run_status };
    const run = await get_run(db, input.workspace_id, input.run_id);
    if (!run) throw new NotFoundError('Run');
    send_run_change(writer, run, cursor);
    await send_new_chat_events(db, input, writer, cursor);
    await send_new_messages(db, input, writer, cursor);
    const job = await find_session_message_job(db, input);
    const job_closed = !job || read_session_message_outcome(job).kind !== 'waiting';
    finished_checks = run_end_statuses.has(run.run_status) && job_closed ? finished_checks + 1 : 0;
    if (finished_checks >= 2) {
      if (cursor.updated_status !== run.run_status) send_run_updated(writer, run, cursor);
      return { done: true, value: run.run_status };
    }
    return check_again;
  }, check_interval_ms);
}

type RunCursor = {
  chat_sequence: number;
  sent_message_ids: Set<string>;
  run_status: string;
  updated_status: string;
};
type StreamedRun = NonNullable<Awaited<ReturnType<typeof get_run>>>;

function send_run_change(writer: Writer, run: StreamedRun, cursor: RunCursor) {
  if (!cursor.run_status) {
    writer.send('run_created', { type: 'run_created', run: public_run(run) });
    cursor.run_status = run.run_status;
    return;
  }
  if (run.run_status !== cursor.run_status) send_run_updated(writer, run, cursor);
}

function send_run_updated(writer: Writer, run: StreamedRun, cursor: RunCursor) {
  writer.send('run_updated', { type: 'run_updated', run: public_run(run) });
  cursor.run_status = run.run_status;
  cursor.updated_status = run.run_status;
}

async function send_new_chat_events(
  db: Database,
  input: StreamInput & { run_id: string },
  writer: Writer,
  cursor: { chat_sequence: number },
): Promise<void> {
  const rows = await read_chat_event_page(db, input, cursor.chat_sequence);
  for (const row of rows) {
    const event = public_chat_stream_event(run_event_row_to_chat_stream_event(row));
    writer.send('chat_event', event, `${event.run_id}:${event.sequence}`);
    cursor.chat_sequence = row.event_sequence;
  }
  if (rows.length === 0 || writer.signal.aborted) return;
  return send_new_chat_events(db, input, writer, cursor);
}

async function read_chat_event_page(
  db: Database,
  input: StreamInput & { run_id: string },
  after_sequence: number,
) {
  const page = await list_run_chat_event_page(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    after_sequence,
  });
  return read_run_events(db, {
    workspace_id: input.workspace_id,
    rows: page,
    payload_reading: 'load_full_value',
  });
}

async function send_new_messages(
  db: Database,
  input: StreamInput & { run_id: string },
  writer: Writer,
  cursor: { sent_message_ids: Set<string> },
) {
  const messages = await list_run_messages(db, input.workspace_id, input.run_id);
  for (const message of messages) {
    if (cursor.sent_message_ids.has(message.run_message_id)) continue;
    cursor.sent_message_ids.add(message.run_message_id);
    writer.send('message_created', {
      type: 'message_created',
      message: public_session_message(message),
    });
  }
}

function stream_error(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'stream_error', message: public_run_failure_message };
}

function sse_frame(event_name: string, data: unknown, id?: string) {
  const id_line = id ? `id: ${id}\n` : '';
  return `${id_line}event: ${event_name}\ndata: ${JSON.stringify(data)}\n\n`;
}
