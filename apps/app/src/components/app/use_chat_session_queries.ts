import { useQuery, useQueryClient } from '@tanstack/react-query';
import { should_poll_runs } from '@/components/app/chat_session_groups';
import { merge_message_pages } from '@/components/app/chat_timeline';
import {
  list_session_messages,
  list_session_runs,
  list_session_tool_calls,
  type RunMessage,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

const live_socket_safety_poll_ms = 10_000;
const chat_poll_ms = 1500;

/** Reads the runs of a chat. It polls while a run works, less often while the live socket is open. */
export function useChatRunsQuery(input: {
  session_id: string | undefined;
  resumed_run_watch_deadline_ms: number;
  has_waiting_messages: boolean;
  is_live_socket_open: boolean;
}) {
  const { session_id } = input;
  return useQuery({
    enabled: Boolean(session_id),
    queryFn: () => list_session_runs(session_id ?? ''),
    queryKey: query_keys.runs(session_id),
    refetchInterval: (query) => {
      const wants_runs =
        should_poll_runs(query.state.data) ||
        Date.now() < input.resumed_run_watch_deadline_ms ||
        input.has_waiting_messages;
      if (!wants_runs) return false;
      return input.is_live_socket_open ? live_socket_safety_poll_ms : chat_poll_ms;
    },
  });
}

/** Reads the newest page of chat messages and merges it with the pages already in the cache. */
export function useChatMessagesQuery(input: {
  session_id: string | undefined;
  polls: boolean;
  set_earlier_messages_cursor: (cursor: number | null) => void;
}) {
  const { session_id } = input;
  const query_client = useQueryClient();
  return useQuery({
    enabled: Boolean(session_id),
    queryFn: async () => {
      const page = await list_session_messages(session_id ?? '');
      const existing = query_client.getQueryData<RunMessage[]>(query_keys.messages(session_id));
      if (!existing || existing.length === 0) input.set_earlier_messages_cursor(page.next_cursor);
      return merge_message_pages(existing, page.items);
    },
    queryKey: query_keys.messages(session_id),
    refetchInterval: input.polls ? chat_poll_ms : false,
  });
}

/** Reads the tool calls of a chat. It polls while a run works and the live socket is closed. */
export function useChatToolCallsQuery(session_id: string | undefined, polls: boolean) {
  return useQuery({
    enabled: Boolean(session_id),
    queryFn: () => list_session_tool_calls(session_id ?? ''),
    queryKey: query_keys.tool_calls(session_id),
    refetchInterval: polls ? chat_poll_ms : false,
  });
}
