import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { type Dispatch, type RefObject, useEffect, useReducer, useRef, useState } from 'react';
import { create_live_event_receiver } from '@/components/app/chat_live_event_receiver';
import { report_live_socket_fallback } from '@/components/app/chat_live_socket_fallback_report';
import {
  chat_live_socket_target,
  initial_chat_live_socket_state,
  next_chat_live_socket_state,
} from '@/components/app/chat_live_socket_state';
import { get_live_stream_ticket } from '@/components/app/chat_live_stream_ticket';
import type { SessionLiveSocket } from '@/lib/rivet_client';

const idle_close_ms = 30_000;

type LiveSocketAction = Parameters<typeof next_chat_live_socket_state>[1];

type NewestRun = { run_id: string | undefined; wants_live: boolean };

type LiveSocketConnection = {
  session_id: string;
  attempt: number;
  query_client: QueryClient;
  dispatch: Dispatch<LiveSocketAction>;
  newest_run_ref: RefObject<NewestRun>;
  on_run_announced: (run_id: string | undefined) => void;
};

function useLiveSocketWanted(
  session_id: string | undefined,
  wants_live: boolean,
  dispatch: Dispatch<LiveSocketAction>,
) {
  useEffect(() => {
    if (!session_id) return;
    if (wants_live) {
      dispatch({ type: 'wanted', session_id });
      return;
    }
    const timer = setTimeout(() => dispatch({ type: 'idle' }), idle_close_ms);
    return () => clearTimeout(timer);
  }, [session_id, wants_live, dispatch]);
  useEffect(() => {
    if (!session_id) return;
    dispatch({ type: 'wanted', session_id });
    return () => dispatch({ type: 'idle' });
  }, [session_id, dispatch]);
}

function open_live_socket(connection: LiveSocketConnection) {
  const { session_id, attempt, dispatch, newest_run_ref } = connection;
  let socket: SessionLiveSocket | undefined;
  let is_cancelled = false;
  const receiver = create_live_event_receiver({
    session_id,
    query_client: connection.query_client,
    on_run_announced: connection.on_run_announced,
  });
  const on_open = () => {
    dispatch({ type: 'opened', attempt, at: Date.now() });
    const newest = newest_run_ref.current;
    if (!newest.wants_live) return;
    receiver.refresh_after_open();
    if (socket) void receiver.fill_gap(socket, newest.run_id);
  };
  const connect = async () => {
    const ticket = await get_live_stream_ticket(session_id);
    if (is_cancelled) return;
    if (!ticket) return dispatch({ type: 'unavailable', attempt });
    const { open_session_live_socket } = await import('@/lib/rivet_client');
    if (is_cancelled) return;
    socket = open_session_live_socket(ticket, {
      on_run_event: receiver.receive,
      on_open,
      on_lost: (reason) => dispatch({ type: 'lost', attempt, at: Date.now(), reason }),
    });
  };
  connect().catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : 'error';
    dispatch({ type: 'lost', attempt, at: Date.now(), reason });
  });
  return () => {
    is_cancelled = true;
    socket?.close();
    connection.on_run_announced(undefined);
  };
}

/** Opens one live socket per chat session while the chat wants live updates. */
export function useChatLiveSocket(input: {
  session_id: string | undefined;
  wants_live: boolean;
  newest_run_id: string | undefined;
}) {
  const query_client = useQueryClient();
  const [state, dispatch] = useReducer(next_chat_live_socket_state, initial_chat_live_socket_state);
  const [announced_run_id, set_announced_run_id] = useState<string | undefined>(undefined);
  const newest_run_ref = useRef<NewestRun>({
    run_id: input.newest_run_id,
    wants_live: input.wants_live,
  });
  newest_run_ref.current = { run_id: input.newest_run_id, wants_live: input.wants_live };
  const target = chat_live_socket_target(state);
  const attempt = target?.attempt;
  const socket_session_id = target?.session_id;
  useLiveSocketWanted(input.session_id, input.wants_live, dispatch);
  useEffect(() => {
    if (!socket_session_id || attempt === undefined) return;
    return open_live_socket({
      session_id: socket_session_id,
      attempt,
      query_client,
      dispatch,
      newest_run_ref,
      on_run_announced: set_announced_run_id,
    });
  }, [attempt, socket_session_id, query_client]);
  useEffect(() => {
    if (state.status !== 'fallen_back') return;
    report_live_socket_fallback(state.reason);
  }, [state]);
  const is_healthy =
    state.status === 'open' &&
    announced_run_id !== undefined &&
    announced_run_id === input.newest_run_id;
  const is_open = state.status === 'open' && state.session_id === input.session_id;
  return { is_healthy, is_open };
}
