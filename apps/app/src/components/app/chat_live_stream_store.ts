import { create } from 'zustand';
import {
  apply_chat_stream_event_to_thread,
  type ChatThreadProjection,
  create_empty_chat_thread_projection,
} from '@/components/app/chat_stream_projection';
import type { ChatStreamEvent } from '@/lib/api';

type ChatLiveStreamState = {
  live_thread_by_session: Record<string, ChatThreadProjection>;
  persisted_cursor_by_run: Record<string, number>;
  selected_artifact_id_by_session: Record<string, string>;
  apply_chat_stream_event: (session_id: string, event: ChatStreamEvent) => void;
  apply_chat_stream_events: (session_id: string, events: readonly ChatStreamEvent[]) => void;
  merge_replayed_chat_events: (session_id: string, events: readonly ChatStreamEvent[]) => void;
  clear_live_thread: (session_id: string) => void;
  select_artifact: (session_id: string, file_id: string) => void;
  clear_selected_artifact: (session_id: string) => void;
};

export const useChatLiveStreamStore = create<ChatLiveStreamState>((set) => ({
  live_thread_by_session: {},
  persisted_cursor_by_run: {},
  selected_artifact_id_by_session: {},
  apply_chat_stream_events: (session_id, events) => {
    if (events.length === 0) return;
    set((state) => ({
      live_thread_by_session: {
        ...state.live_thread_by_session,
        [session_id]: apply_chat_events_to_thread(
          state.live_thread_by_session[session_id] ?? create_empty_chat_thread_projection(),
          events,
        ),
      },
    }));
  },
  apply_chat_stream_event: (session_id, event) =>
    useChatLiveStreamStore.getState().apply_chat_stream_events(session_id, [event]),
  merge_replayed_chat_events: (session_id, events) => {
    if (events.length === 0) return;
    useChatLiveStreamStore.getState().apply_chat_stream_events(session_id, events);
    set((state) => {
      const next_cursors = { ...state.persisted_cursor_by_run };
      for (const event of events) {
        next_cursors[event.run_id] = Math.max(next_cursors[event.run_id] ?? 0, event.sequence);
      }
      return { persisted_cursor_by_run: next_cursors };
    });
  },
  clear_live_thread: (session_id) =>
    set((state) => {
      const next_threads = { ...state.live_thread_by_session };
      const discarded_run_ids = new Set(
        (next_threads[session_id]?.items ?? []).map((item) => item.run_id),
      );
      delete next_threads[session_id];
      const next_cursors = Object.fromEntries(
        Object.entries(state.persisted_cursor_by_run).filter(
          ([run_id]) => !discarded_run_ids.has(run_id),
        ),
      );
      return { live_thread_by_session: next_threads, persisted_cursor_by_run: next_cursors };
    }),
  select_artifact: (session_id, file_id) =>
    set((state) => ({
      selected_artifact_id_by_session: {
        ...state.selected_artifact_id_by_session,
        [session_id]: file_id,
      },
    })),
  clear_selected_artifact: (session_id) =>
    set((state) => {
      const next = { ...state.selected_artifact_id_by_session };
      delete next[session_id];
      return { selected_artifact_id_by_session: next };
    }),
}));

function apply_chat_events_to_thread(
  projection: ChatThreadProjection,
  events: readonly ChatStreamEvent[],
) {
  return events.reduce(
    (next_projection, event) => apply_chat_stream_event_to_thread(next_projection, event),
    projection,
  );
}
