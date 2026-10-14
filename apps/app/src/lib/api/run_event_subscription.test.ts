import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '@/lib/api';
import { subscribe_to_run_events } from '@/lib/api/run_event_subscription';

describe('subscribe_to_run_events', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps persisted chat_event frames arriving across chunk boundaries', async () => {
    vi.useFakeTimers();
    const frame = run_event_frame(7);
    const fetch_mock = vi
      .fn()
      .mockResolvedValueOnce(
        sse_response([': keep-alive\n\n', frame.slice(0, 30), frame.slice(30), stream_end_frame()]),
      );
    vi.stubGlobal('fetch', fetch_mock);

    const received: ChatStreamEvent[] = [];
    const health: boolean[] = [];
    const subscription = subscribe_to_run_events({
      run_id: 'run_1',
      on_chat_event: (event) => received.push(event),
      on_health_change: (is_healthy) => health.push(is_healthy),
    });
    await vi.advanceTimersByTimeAsync(0);
    subscription.close();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      event_id: 'rev_7',
      run_id: 'run_1',
      session_id: 'ses_1',
      sequence: 7,
      event_type: 'item_completed',
      occurred_time: '2026-06-16T00:00:00.000Z',
      item: { item_id: 'run_1:assistant:0' },
    });
    expect(health).toEqual([true, false]);
    expect(fetch_mock).toHaveBeenCalledTimes(1);
  });

  it('opens without a cursor and resumes from the last event_sequence it received', async () => {
    vi.useFakeTimers();
    const fetch_mock = vi
      .fn()
      .mockResolvedValueOnce(sse_response([non_chat_run_event_frame(4), run_event_frame(5)]))
      .mockResolvedValueOnce(sse_response([run_event_frame(6), stream_end_frame()]));
    vi.stubGlobal('fetch', fetch_mock);

    const received: ChatStreamEvent[] = [];
    const subscription = subscribe_to_run_events({
      run_id: 'run_1',
      on_chat_event: (event) => received.push(event),
      on_health_change: () => {},
    });
    await vi.advanceTimersByTimeAsync(1500);
    subscription.close();

    expect(fetch_mock).toHaveBeenCalledTimes(2);
    expect(request_headers(fetch_mock, 0)['Last-Event-ID']).toBeUndefined();
    expect(request_headers(fetch_mock, 0).Accept).toBe('text/event-stream');
    expect(request_headers(fetch_mock, 1)['Last-Event-ID']).toBe('5');
    expect(received.map((event) => event.sequence)).toEqual([5, 6]);
  });

  it('resumes from the caller cursor instead of replaying the whole run', async () => {
    vi.useFakeTimers();
    const fetch_mock = vi.fn().mockResolvedValue(sse_response([stream_end_frame()]));
    vi.stubGlobal('fetch', fetch_mock);

    subscribe_to_run_events({
      run_id: 'run_1',
      after_event_sequence: 42,
      on_chat_event: () => {},
      on_health_change: () => {},
    }).close();
    await vi.advanceTimersByTimeAsync(0);

    expect(request_headers(fetch_mock, 0)['Last-Event-ID']).toBe('42');
  });

  it('stops reconnecting once the run stream ends', async () => {
    vi.useFakeTimers();
    const fetch_mock = vi.fn().mockResolvedValue(sse_response([stream_end_frame()]));
    vi.stubGlobal('fetch', fetch_mock);

    const subscription = subscribe_to_run_events({
      run_id: 'run_1',
      on_chat_event: () => {},
      on_health_change: () => {},
    });
    await vi.advanceTimersByTimeAsync(30_000);
    subscription.close();

    expect(fetch_mock).toHaveBeenCalledTimes(1);
  });

  it('never reports healthy when the stream cannot open, so the poll keeps covering', async () => {
    vi.useFakeTimers();
    const fetch_mock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValue(sse_response([stream_end_frame()]));
    vi.stubGlobal('fetch', fetch_mock);

    const health: boolean[] = [];
    const subscription = subscribe_to_run_events({
      run_id: 'run_1',
      on_chat_event: () => {},
      on_health_change: (is_healthy) => health.push(is_healthy),
    });
    await vi.advanceTimersByTimeAsync(2500);
    subscription.close();

    expect(health.slice(0, 2)).toEqual([false, false]);
    expect(fetch_mock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

function request_headers(fetch_mock: ReturnType<typeof vi.fn>, call_index: number) {
  const init = fetch_mock.mock.calls[call_index]?.[1] as RequestInit;
  return (init.headers ?? {}) as Record<string, string>;
}

function sse_response(chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function run_event_frame(event_sequence: number) {
  return format_run_event_frame(event_sequence, {
    event_type: 'chat_event',
    event_label: 'item_completed',
    event_payload: {
      event_type: 'item_completed',
      item: { item_id: 'run_1:assistant:0', item_type: 'assistant_message' },
      source: { source_type: 'runtime_event' },
    },
  });
}

function non_chat_run_event_frame(event_sequence: number) {
  return format_run_event_frame(event_sequence, {
    event_type: 'progress',
    event_label: 'pi.turn_start',
    event_payload: { label: 'pi.turn_start' },
  });
}

function format_run_event_frame(
  event_sequence: number,
  event: { event_type: string; event_label: string; event_payload: unknown },
) {
  const data = {
    run_event_id: `rev_${event_sequence}`,
    run_id: 'run_1',
    session_id: 'ses_1',
    event_sequence,
    created_time: '2026-06-16T00:00:00.000Z',
    ...event,
  };
  return `id: ${event_sequence}\nevent: run_event\ndata: ${JSON.stringify(data)}\n\n`;
}

function stream_end_frame() {
  return 'event: stream_end\ndata: {"reason":"end_event"}\n\n';
}
