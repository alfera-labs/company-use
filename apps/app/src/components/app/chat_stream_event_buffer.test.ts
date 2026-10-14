import { describe, expect, it } from 'vitest';
import { create_chat_stream_event_buffer } from '@/components/app/chat_stream_event_buffer';
import type { ChatStreamEvent } from '@/lib/api';

describe('chat stream event buffer', () => {
  it('collapses every event between two frames into one update', () => {
    const applied: Array<{ session_id: string; event_count: number }> = [];
    const frame = create_manual_frame();
    const buffer = create_chat_stream_event_buffer({
      apply_events: (session_id, events) =>
        applied.push({ session_id, event_count: events.length }),
      schedule_flush: frame.schedule,
    });

    buffer.add_event('ses_1', chat_event('evt_1'));
    buffer.add_event('ses_1', chat_event('evt_2'));
    buffer.add_event('ses_1', chat_event('evt_3'));
    expect(applied).toEqual([]);

    frame.run();
    expect(applied).toEqual([{ session_id: 'ses_1', event_count: 3 }]);
  });

  it('keeps every event, in order, within a batch', () => {
    const applied_event_ids: string[] = [];
    const frame = create_manual_frame();
    const buffer = create_chat_stream_event_buffer({
      apply_events: (_session_id, events) =>
        applied_event_ids.push(...events.map((event) => event.event_id)),
      schedule_flush: frame.schedule,
    });

    buffer.add_event('ses_1', chat_event('evt_1'));
    buffer.add_event('ses_1', chat_event('evt_2'));
    frame.run();

    expect(applied_event_ids).toEqual(['evt_1', 'evt_2']);
  });

  it('keeps two sessions in separate batches', () => {
    const applied: string[] = [];
    const frame = create_manual_frame();
    const buffer = create_chat_stream_event_buffer({
      apply_events: (session_id) => applied.push(session_id),
      schedule_flush: frame.schedule,
    });

    buffer.add_event('ses_1', chat_event('evt_1'));
    buffer.add_event('ses_2', chat_event('evt_2'));
    frame.run();

    expect(applied).toEqual(['ses_1', 'ses_2']);
  });

  it('schedules a new flush for events that arrive after one ran', () => {
    const applied: number[] = [];
    const frame = create_manual_frame();
    const buffer = create_chat_stream_event_buffer({
      apply_events: (_session_id, events) => applied.push(events.length),
      schedule_flush: frame.schedule,
    });

    buffer.add_event('ses_1', chat_event('evt_1'));
    frame.run();
    buffer.add_event('ses_1', chat_event('evt_2'));
    frame.run();

    expect(applied).toEqual([1, 1]);
  });

  it('flushes on demand so the end of a run never leaves events waiting', () => {
    const applied: number[] = [];
    const frame = create_manual_frame();
    const buffer = create_chat_stream_event_buffer({
      apply_events: (_session_id, events) => applied.push(events.length),
      schedule_flush: frame.schedule,
    });

    buffer.add_event('ses_1', chat_event('evt_1'));
    buffer.flush_events();
    expect(applied).toEqual([1]);

    frame.run();
    expect(applied).toEqual([1]);
  });
});

function create_manual_frame() {
  let scheduled_flush: (() => void) | undefined;
  return {
    schedule: (flush_events: () => void) => {
      scheduled_flush = flush_events;
    },
    run: () => {
      const flush_events = scheduled_flush;
      scheduled_flush = undefined;
      flush_events?.();
    },
  };
}

function chat_event(event_id: string) {
  return { event_id, event_type: 'item_delta' } as ChatStreamEvent;
}
