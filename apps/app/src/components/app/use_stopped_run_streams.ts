import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import { read_run_chat_stream_events } from '@/components/app/chat_stream_event_pages';
import type { Run, RunMessage } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

const most_stopped_runs_read_again = 5;

/** The runs a person stopped whose messages are in the chat on screen, newest first. */
export function stopped_run_ids_on_screen(
  runs: readonly Run[] | undefined,
  messages: readonly RunMessage[],
) {
  const run_ids_on_screen = new Set(messages.map((message) => message.run_id));
  return (runs ?? [])
    .filter((run) => run.run_status === 'cancelled' && run_ids_on_screen.has(run.run_id))
    .map((run) => run.run_id);
}

/**
 * Reads what the stopped runs of the chat streamed and gives the ids of those runs. The part of
 * an answer that a stop cut off is in the stream of its run and in no stored message, so after a
 * reload the chat reads the stream again, or the stopped answer is gone.
 */
export function useStoppedRunStreams(input: {
  session_id: string | undefined;
  runs: readonly Run[] | undefined;
  messages: readonly RunMessage[];
}) {
  const { session_id, runs, messages } = input;
  const stopped_run_ids = useMemo(
    () => stopped_run_ids_on_screen(runs, messages),
    [runs, messages],
  );
  const merge_replayed_chat_events = useChatLiveStreamStore(
    (state) => state.merge_replayed_chat_events,
  );
  const streams = useQueries({
    queries: stopped_run_ids.slice(0, most_stopped_runs_read_again).map((run_id) => ({
      enabled: Boolean(session_id),
      queryFn: () => read_run_chat_stream_events(run_id),
      queryKey: query_keys.chat_stream_events(run_id),
    })),
    combine: (results) => results.flatMap((result) => result.data ?? []),
  });
  useEffect(() => {
    if (session_id) merge_replayed_chat_events(session_id, streams);
  }, [merge_replayed_chat_events, session_id, streams]);
  return stopped_run_ids;
}
