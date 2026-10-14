export type ChatLiveSocketState =
  | { status: 'off'; attempt: number }
  | { status: 'connecting'; attempt: number; session_id: string; is_retry: boolean }
  | { status: 'open'; attempt: number; session_id: string; is_retry: boolean; opened_at: number }
  | { status: 'fallen_back'; attempt: number; session_id: string; reason: string };

export type ChatLiveSocketEvent =
  | { type: 'wanted'; session_id: string }
  | { type: 'idle' }
  | { type: 'opened'; attempt: number; at: number }
  | { type: 'lost'; attempt: number; at: number; reason: string }
  | { type: 'unavailable'; attempt: number };

export const initial_chat_live_socket_state: ChatLiveSocketState = { status: 'off', attempt: 0 };

const healthy_open_ms = 30_000;
export const live_stream_unavailable_reason = 'live stream unavailable';

export function next_chat_live_socket_state(
  state: ChatLiveSocketState,
  event: ChatLiveSocketEvent,
): ChatLiveSocketState {
  if (event.type === 'idle') return { status: 'off', attempt: state.attempt };
  if (event.type === 'wanted') {
    if (state.status !== 'off' && state.session_id === event.session_id) return state;
    const { session_id } = event;
    return { status: 'connecting', attempt: state.attempt + 1, session_id, is_retry: false };
  }
  if (event.attempt !== state.attempt) return state;
  if (state.status !== 'connecting' && state.status !== 'open') return state;
  if (event.type === 'unavailable') return fall_back(state, live_stream_unavailable_reason);
  if (event.type === 'opened') {
    if (state.status === 'open') return state;
    return { ...state, status: 'open', opened_at: event.at };
  }
  if (state.is_retry && !stayed_open(state, event.at)) return fall_back(state, event.reason);
  const { session_id } = state;
  return { status: 'connecting', attempt: state.attempt + 1, session_id, is_retry: true };
}

export function chat_live_socket_target(state: ChatLiveSocketState) {
  if (state.status !== 'connecting' && state.status !== 'open') return undefined;
  return { attempt: state.attempt, session_id: state.session_id };
}

function stayed_open(state: ChatLiveSocketState, lost_at: number) {
  return state.status === 'open' && lost_at - state.opened_at >= healthy_open_ms;
}

function fall_back(
  state: { attempt: number; session_id: string },
  reason: string,
): ChatLiveSocketState {
  return { status: 'fallen_back', attempt: state.attempt, session_id: state.session_id, reason };
}
