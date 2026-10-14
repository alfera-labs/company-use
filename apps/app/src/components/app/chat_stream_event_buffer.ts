import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import type { ChatStreamEvent } from '@/lib/api';

type ChatStreamEventBuffer = {
  add_event: (session_id: string, event: ChatStreamEvent) => void;
  flush_events: () => void;
};

export function create_chat_stream_event_buffer(input: {
  apply_events: (session_id: string, events: ChatStreamEvent[]) => void;
  schedule_flush: (flush_events: () => void) => void;
}): ChatStreamEventBuffer {
  const pending_events_by_session = new Map<string, ChatStreamEvent[]>();
  let flush_is_scheduled = false;

  function flush_events() {
    flush_is_scheduled = false;
    const flushed_sessions = [...pending_events_by_session];
    pending_events_by_session.clear();
    for (const [session_id, events] of flushed_sessions) input.apply_events(session_id, events);
  }

  function add_event(session_id: string, event: ChatStreamEvent) {
    const pending_events = pending_events_by_session.get(session_id);
    if (pending_events) pending_events.push(event);
    else pending_events_by_session.set(session_id, [event]);

    if (flush_is_scheduled) return;
    flush_is_scheduled = true;
    input.schedule_flush(flush_events);
  }

  return { add_event, flush_events };
}

function schedule_flush_on_next_frame(flush_events: () => void) {
  if (typeof window === 'undefined' || !window.requestAnimationFrame) {
    queueMicrotask(flush_events);
    return;
  }
  window.requestAnimationFrame(flush_events);
}

const chat_stream_event_buffer = create_chat_stream_event_buffer({
  apply_events: (session_id, events) =>
    useChatLiveStreamStore.getState().apply_chat_stream_events(session_id, events),
  schedule_flush: schedule_flush_on_next_frame,
});

export function buffer_chat_stream_event(session_id: string, event: ChatStreamEvent) {
  chat_stream_event_buffer.add_event(session_id, event);
}

export function flush_chat_stream_events() {
  chat_stream_event_buffer.flush_events();
}
