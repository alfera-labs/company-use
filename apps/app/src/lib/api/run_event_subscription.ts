import type { LiveRunEvent } from '@coworker/shared';
import { api_fetch, run_by_id_client } from '@/lib/api/client';
import { read_sse_frames_from_response_body } from '@/lib/api/sse_frames';
import type { ChatStreamEvent } from '@/lib/api/types';

const first_reconnect_delay_ms = 1000;
const longest_reconnect_delay_ms = 15_000;

export type RunEventSubscriptionInput = {
  run_id: string;
  after_event_sequence?: number;
  on_chat_event: (event: ChatStreamEvent) => void;
  on_health_change: (is_healthy: boolean) => void;
};

export function subscribe_to_run_events(input: RunEventSubscriptionInput) {
  const subscription_lifetime = new AbortController();
  void follow_run_events(input, subscription_lifetime.signal);
  return { close: () => subscription_lifetime.abort() };
}

async function follow_run_events(input: RunEventSubscriptionInput, signal: AbortSignal) {
  let cursor = input.after_event_sequence ?? 0;
  let reconnect_delay_ms = first_reconnect_delay_ms;

  while (!signal.aborted) {
    const stream = await read_run_event_stream(input, cursor, signal).catch((error: unknown) => {
      console.debug('run event stream dropped; reconnecting', error);
      return null;
    });
    input.on_health_change(false);
    if (signal.aborted) return;

    if (stream) {
      cursor = stream.cursor;
      if (stream.stream_ended) return;
      reconnect_delay_ms = first_reconnect_delay_ms;
    }

    await wait_for_milliseconds(reconnect_delay_ms, signal);
    reconnect_delay_ms = Math.min(reconnect_delay_ms * 2, longest_reconnect_delay_ms);
  }
}

async function read_run_event_stream(
  input: RunEventSubscriptionInput,
  cursor: number,
  signal: AbortSignal,
) {
  const url = run_by_id_client.events.$url({ param: { run_id: input.run_id } });
  const response = await api_fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'text/event-stream',
      ...(cursor > 0 ? { 'Last-Event-ID': String(cursor) } : {}),
    },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url.pathname} did not open a run event stream (${response.status})`);
  }

  input.on_health_change(true);
  let last_event_sequence = cursor;
  let stream_ended = false;
  await read_sse_frames_from_response_body(response.body, (frame) => {
    if (frame.event_name === 'stream_end') {
      stream_ended = true;
      return;
    }
    if (frame.event_name !== 'run_event') return;

    const run_event = JSON.parse(frame.data) as LiveRunEvent<ChatStreamEvent>;
    last_event_sequence = Math.max(last_event_sequence, run_event.event_sequence);
    if (run_event.event_type === 'chat_event') {
      input.on_chat_event(live_run_event_to_chat_stream_event(run_event));
    }
  });

  return { cursor: last_event_sequence, stream_ended };
}

function live_run_event_to_chat_stream_event(
  run_event: LiveRunEvent<ChatStreamEvent>,
): ChatStreamEvent {
  const payload = run_event.event_payload;
  return {
    ...payload,
    event_id: run_event.run_event_id,
    session_id: run_event.session_id,
    run_id: run_event.run_id,
    sequence: run_event.event_sequence,
    event_type: typeof payload.event_type === 'string' ? payload.event_type : run_event.event_label,
    occurred_time: run_event.created_time,
  } as ChatStreamEvent;
}

function wait_for_milliseconds(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}
