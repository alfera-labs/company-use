import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import { is_chat_run_active } from '@/components/app/chat_session_state';
import {
  buffer_chat_stream_event,
  flush_chat_stream_events,
} from '@/components/app/chat_stream_event_buffer';
import { read_missed_live_events } from '@/components/app/chat_stream_event_pages';
import { query_keys } from '@/lib/api/query_keys';
import type { Run } from '@/lib/api/types';
import type { LiveRunEvent, SessionLiveSocket } from '@/lib/rivet_client';

type LiveEventReceiverInput = {
  session_id: string;
  query_client: QueryClient;
  on_run_announced: (run_id: string) => void;
};

type RunEvent = Extract<LiveRunEvent, { type: 'run_created' | 'run_updated' }>;

function refresh_queries(query_client: QueryClient, ...query_keys_to_refresh: QueryKey[]) {
  for (const query_key of query_keys_to_refresh) {
    void query_client.invalidateQueries({ queryKey: query_key });
  }
}

function write_run_to_cache(query_client: QueryClient, session_id: string, run: Run) {
  query_client.setQueryData<Run[]>(query_keys.runs(session_id), (runs = []) =>
    runs.some((cached) => cached.run_id === run.run_id)
      ? runs.map((cached) => (cached.run_id === run.run_id ? run : cached))
      : [run, ...runs],
  );
}

function apply_chat_event(
  session_id: string,
  event: Extract<LiveRunEvent, { type: 'chat_event' }>,
) {
  if (event.event.event_type === 'item_delta') {
    buffer_chat_stream_event(session_id, event.event);
    return;
  }
  flush_chat_stream_events();
  useChatLiveStreamStore.getState().merge_replayed_chat_events(session_id, [event.event]);
}

function apply_run_created(input: LiveEventReceiverInput, event: RunEvent) {
  const { session_id, query_client } = input;
  input.on_run_announced(event.run.run_id);
  write_run_to_cache(query_client, session_id, event.run);
  refresh_queries(query_client, query_keys.sessions());
  refresh_queries(
    query_client,
    query_keys.runs(session_id),
    query_keys.queued_messages(session_id),
  );
}

function apply_run_updated(input: LiveEventReceiverInput, event: RunEvent) {
  const { session_id, query_client } = input;
  write_run_to_cache(query_client, session_id, event.run);
  refresh_queries(query_client, query_keys.runs(session_id));
  if (event.run.run_status === 'waiting') {
    refresh_queries(
      query_client,
      query_keys.tool_calls(session_id),
      query_keys.open_choices_wait(session_id),
    );
    return;
  }
  if (is_chat_run_active(event.run.run_status)) return;
  flush_chat_stream_events();
  refresh_queries(query_client, query_keys.sessions());
  refresh_queries(
    query_client,
    query_keys.messages(session_id),
    query_keys.tool_calls(session_id),
    query_keys.sandbox_previews(session_id),
  );
}

function apply_live_event(input: LiveEventReceiverInput, event: LiveRunEvent) {
  if (event.type === 'chat_event') return apply_chat_event(input.session_id, event);
  if (event.type === 'message_created') {
    return refresh_queries(input.query_client, query_keys.messages(input.session_id));
  }
  if (event.type === 'run_created') return apply_run_created(input, event);
  apply_run_updated(input, event);
}

/** Applies live socket events to the chat caches, and holds them while it reads missed events. */
export function create_live_event_receiver(input: LiveEventReceiverInput) {
  const { session_id, query_client } = input;
  let waiting: LiveRunEvent[] | null = null;
  const apply = (event: LiveRunEvent) => apply_live_event(input, event);
  return {
    refresh_after_open: () =>
      refresh_queries(
        query_client,
        query_keys.runs(session_id),
        query_keys.queued_messages(session_id),
      ),
    receive: (event: LiveRunEvent) => {
      if (waiting) waiting.push(event);
      else apply(event);
    },
    fill_gap: async (socket: SessionLiveSocket, run_id: string | undefined) => {
      if (!run_id || waiting) return;
      waiting = [];
      try {
        await read_missed_live_events(socket, session_id, run_id);
      } catch (error) {
        console.warn(
          '[chat live socket] could not read the events missed while reconnecting',
          error,
        );
      } finally {
        const held = waiting ?? [];
        waiting = null;
        for (const event of held) apply(event);
      }
    },
  };
}
