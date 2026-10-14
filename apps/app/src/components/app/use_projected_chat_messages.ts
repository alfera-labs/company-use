import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { live_replies_not_yet_saved } from '@/components/app/chat_live_reply_overlap';
import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import { split_stored_messages_and_own_copies } from '@/components/app/chat_own_copy_order';
import {
  chat_thread_artifact_items,
  chat_thread_assistant_message_items,
  chat_thread_source_items,
  chat_thread_thinking_items,
  chat_thread_tool_calls,
  chat_tool_call_node_key,
  create_projected_chat_messages,
  merge_chat_tool_calls,
} from '@/components/app/chat_stream_projection';
import { useStoppedRunStreams } from '@/components/app/use_stopped_run_streams';
import {
  type CatalogNode,
  list_catalog_nodes,
  type Run,
  type RunMessage,
  type Session,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

type SavedToolCalls = Parameters<typeof merge_chat_tool_calls>[0];

type ProjectedChatMessagesInput = {
  session_id: string | undefined;
  latest_run_id: string | undefined;
  saved_tool_calls: SavedToolCalls | undefined;
  session_messages: RunMessage[];
  selected_session: Session | undefined;
  runs: readonly Run[] | undefined;
};

function useLiveThreadItems(session_id: string | undefined) {
  const live_thread = useChatLiveStreamStore((state) =>
    session_id ? state.live_thread_by_session[session_id] : undefined,
  );
  const assistant_message_items = useMemo(
    () => chat_thread_assistant_message_items(live_thread),
    [live_thread],
  );
  const thinking_items = useMemo(() => chat_thread_thinking_items(live_thread), [live_thread]);
  const artifact_items = useMemo(() => chat_thread_artifact_items(live_thread), [live_thread]);
  const source_items = useMemo(() => chat_thread_source_items(live_thread), [live_thread]);
  return useMemo(
    () => ({ live_thread, assistant_message_items, thinking_items, artifact_items, source_items }),
    [live_thread, assistant_message_items, thinking_items, artifact_items, source_items],
  );
}

function useCatalogNodesOfToolCalls(visible_tool_calls: ReturnType<typeof merge_chat_tool_calls>) {
  const visible_tool_node_keys = useMemo(
    () => [...new Set(visible_tool_calls.map(chat_tool_call_node_key))],
    [visible_tool_calls],
  );
  return useQuery({
    enabled: visible_tool_node_keys.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => list_catalog_nodes(visible_tool_node_keys),
    queryKey: query_keys.catalog_nodes(visible_tool_node_keys),
  });
}

function session_source_actors(session: Session | undefined) {
  return session?.session_metadata.actors ?? [];
}

type LiveThreadItems = ReturnType<typeof useLiveThreadItems>;

function project_stored_messages_then_own_copies(input: {
  latest_run_id: string | undefined;
  stopped_run_ids: readonly string[];
  live: LiveThreadItems;
  catalog_nodes: CatalogNode[];
  session_messages: RunMessage[];
  selected_session: Session | undefined;
  tool_calls: ReturnType<typeof merge_chat_tool_calls>;
}) {
  const { latest_run_id, stopped_run_ids, live, session_messages } = input;
  const { stored_messages, own_copies } = split_stored_messages_and_own_copies(session_messages);
  const source_actors = session_source_actors(input.selected_session);
  const assistant_message_items = [...stopped_run_ids, latest_run_id].reduce(
    (items, run_id) => live_replies_not_yet_saved(items, session_messages, run_id),
    live.assistant_message_items,
  );
  return [
    ...create_projected_chat_messages({
      ...(latest_run_id ? { active_run_id: latest_run_id } : {}),
      stopped_run_ids,
      assistant_message_items,
      artifact_items: live.artifact_items,
      catalog_nodes: input.catalog_nodes,
      messages: stored_messages,
      source_actors,
      source_items: live.source_items,
      thinking_items: live.thinking_items,
      tool_calls: input.tool_calls,
    }),
    ...create_projected_chat_messages({ messages: own_copies, source_actors, tool_calls: [] }),
  ];
}

/**
 * Projects saved messages, tool calls, the live stream of the newest run and what the stopped
 * runs streamed into chat bubbles.
 */
export function useProjectedChatMessages(input: ProjectedChatMessagesInput) {
  const { latest_run_id, saved_tool_calls, session_messages, selected_session } = input;
  const live = useLiveThreadItems(input.session_id);
  const stopped_run_ids = useStoppedRunStreams({
    session_id: input.session_id,
    runs: input.runs,
    messages: session_messages,
  });
  const visible_tool_calls = useMemo(
    () =>
      merge_chat_tool_calls(
        saved_tool_calls ?? [],
        latest_run_id
          ? chat_thread_tool_calls(live.live_thread).filter(
              (tool_call) => tool_call.run_id === latest_run_id,
            )
          : [],
      ),
    [latest_run_id, live.live_thread, saved_tool_calls],
  );
  const catalog_nodes = useCatalogNodesOfToolCalls(visible_tool_calls).data;
  const chat_messages = useMemo(
    () =>
      project_stored_messages_then_own_copies({
        latest_run_id,
        stopped_run_ids,
        live,
        catalog_nodes: catalog_nodes ?? [],
        session_messages,
        selected_session,
        tool_calls: visible_tool_calls,
      }),
    [
      catalog_nodes,
      latest_run_id,
      live,
      selected_session,
      session_messages,
      stopped_run_ids,
      visible_tool_calls,
    ],
  );
  return { visible_tool_calls, artifact_items: live.artifact_items, chat_messages };
}
