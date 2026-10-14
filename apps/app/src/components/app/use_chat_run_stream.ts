import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import { read_run_chat_stream_events } from '@/components/app/chat_stream_event_pages';
import { subscribe_to_run_events } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

type ChatRunStreamInput = {
  session_id: string | undefined;
  latest_run_id: string | undefined;
  is_send_pending: boolean;
  should_poll_runtime: boolean;
  is_live_socket_healthy: boolean;
};

function useFollowRunEvents(
  session_id: string | undefined,
  followed_run_id: string | undefined,
  set_is_healthy: (is_healthy: boolean) => void,
) {
  const query_client = useQueryClient();
  const merge_replayed_chat_events = useChatLiveStreamStore(
    (state) => state.merge_replayed_chat_events,
  );
  useEffect(() => {
    if (!session_id || !followed_run_id) return;
    const subscription = subscribe_to_run_events({
      run_id: followed_run_id,
      after_event_sequence:
        useChatLiveStreamStore.getState().persisted_cursor_by_run[followed_run_id] ?? 0,
      on_chat_event: (event) => merge_replayed_chat_events(session_id, [event]),
      on_health_change: set_is_healthy,
    });
    return () => {
      subscription.close();
      set_is_healthy(false);
      void query_client.invalidateQueries({ queryKey: query_keys.messages(session_id) });
      void query_client.invalidateQueries({ queryKey: query_keys.tool_calls(session_id) });
    };
  }, [merge_replayed_chat_events, followed_run_id, query_client, session_id, set_is_healthy]);
}

/**
 * Follows the stream of the newest run when the live socket cannot: it replays saved events,
 * polls them while no stream is healthy, and subscribes to the per-run event stream.
 */
export function useChatRunStream(input: ChatRunStreamInput) {
  const { session_id, latest_run_id } = input;
  const [is_run_event_stream_healthy, set_is_run_event_stream_healthy] = useState(false);
  const merge_replayed_chat_events = useChatLiveStreamStore(
    (state) => state.merge_replayed_chat_events,
  );
  const chat_stream_events_query = useQuery({
    enabled: Boolean(session_id && latest_run_id && !input.is_send_pending),
    queryFn: () => read_run_chat_stream_events(latest_run_id ?? ''),
    queryKey: query_keys.chat_stream_events(latest_run_id),
    refetchInterval:
      input.should_poll_runtime && !is_run_event_stream_healthy && !input.is_live_socket_healthy
        ? 1000
        : false,
  });
  useEffect(() => {
    if (!session_id || !chat_stream_events_query.data) return;
    merge_replayed_chat_events(session_id, chat_stream_events_query.data);
  }, [merge_replayed_chat_events, chat_stream_events_query.data, session_id]);
  const followed_run_id =
    input.should_poll_runtime && !input.is_live_socket_healthy ? latest_run_id : undefined;
  useFollowRunEvents(session_id, followed_run_id, set_is_run_event_stream_healthy);
}
