import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import { chat_stream_events_page_limit, list_run_chat_stream_events } from '@/lib/api';
import type { ChatStreamEvent } from '@/lib/api/types';
import type { SessionLiveSocket } from '@/lib/rivet_client';

type ChatStreamStore = ReturnType<typeof useChatLiveStreamStore.getState>;

type MissedLiveEventsRead = {
  socket: SessionLiveSocket;
  store: ChatStreamStore;
  session_id: string;
  run_id: string;
};

async function read_live_event_pages_after(
  read: MissedLiveEventsRead,
  after_sequence: number,
): Promise<void> {
  const page = await read.socket.events_after({ run_id: read.run_id, after_sequence });
  read.store.merge_replayed_chat_events(read.session_id, page);
  const newest_sequence = page.at(-1)?.sequence;
  if (page.length < chat_stream_events_page_limit || newest_sequence === undefined) return;
  await read_live_event_pages_after(read, newest_sequence);
}

/** Reads, page by page over the live socket, the run events missed while it reconnected. */
export async function read_missed_live_events(
  socket: SessionLiveSocket,
  session_id: string,
  run_id: string,
) {
  const store = useChatLiveStreamStore.getState();
  const after_sequence = store.persisted_cursor_by_run[run_id] ?? 0;
  await read_live_event_pages_after({ socket, store, session_id, run_id }, after_sequence);
}

async function read_run_event_pages_after(
  run_id: string,
  after_sequence: number | undefined,
  events: ChatStreamEvent[],
): Promise<ChatStreamEvent[]> {
  const page = await list_run_chat_stream_events(run_id, {
    ...(after_sequence === undefined ? {} : { after_sequence }),
  });
  events.push(...page);
  if (page.length < chat_stream_events_page_limit) return events;
  const newest_sequence = page.at(-1)?.sequence;
  if (newest_sequence === undefined || newest_sequence === after_sequence) return events;
  return read_run_event_pages_after(run_id, newest_sequence, events);
}

/** Reads, page by page over HTTP, the chat stream events of a run after the saved cursor. */
export function read_run_chat_stream_events(run_id: string) {
  const after_sequence = useChatLiveStreamStore.getState().persisted_cursor_by_run[run_id];
  return read_run_event_pages_after(run_id, after_sequence, []);
}
