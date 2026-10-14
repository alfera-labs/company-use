import { describe, expect, it } from 'vitest';
import {
  type ChatLiveSocketEvent,
  type ChatLiveSocketState,
  chat_live_socket_target,
  initial_chat_live_socket_state,
  next_chat_live_socket_state,
} from '@/components/app/chat_live_socket_state';

const chat = 'ses_a';
const wanted: ChatLiveSocketEvent = { type: 'wanted', session_id: chat };

function run_events(events: ChatLiveSocketEvent[], from = initial_chat_live_socket_state) {
  return events.reduce<ChatLiveSocketState>(next_chat_live_socket_state, from);
}

describe('chat live socket state', () => {
  it('opens a socket when the chat wants one, and closes it when the chat goes idle', () => {
    const open = run_events([wanted, { type: 'opened', attempt: 1, at: 0 }]);
    expect(open).toEqual({
      status: 'open',
      attempt: 1,
      session_id: chat,
      is_retry: false,
      opened_at: 0,
    });
    expect(chat_live_socket_target(open)).toEqual({ attempt: 1, session_id: chat });

    const closed = next_chat_live_socket_state(open, { type: 'idle' });
    expect(closed.status).toBe('off');
    expect(chat_live_socket_target(closed)).toBeUndefined();
    expect(next_chat_live_socket_state(closed, wanted)).toEqual({
      status: 'connecting',
      attempt: 2,
      session_id: chat,
      is_retry: false,
    });
  });

  it('reconnects once with a new socket when an open socket is lost', () => {
    const retrying = run_events([
      wanted,
      { type: 'opened', attempt: 1, at: 0 },
      { type: 'lost', attempt: 1, at: 1_000, reason: 'closed and not reopened in 3 s' },
    ]);
    expect(retrying).toEqual({
      status: 'connecting',
      attempt: 2,
      session_id: chat,
      is_retry: true,
    });

    const open_again = next_chat_live_socket_state(retrying, { type: 'opened', attempt: 2, at: 0 });
    expect(
      next_chat_live_socket_state(open_again, {
        type: 'lost',
        attempt: 2,
        at: 5 * 60_000,
        reason: 'error run_stream_ticket_refused',
      }),
    ).toEqual({ status: 'connecting', attempt: 3, session_id: chat, is_retry: true });
  });

  it('falls back after one quick retry when a socket opens and fails again and again', () => {
    const open_then_fail = (attempt: number, at: number): ChatLiveSocketEvent[] => [
      { type: 'opened', attempt, at },
      { type: 'lost', attempt, at: at + 2_000, reason: 'error' },
    ];
    const retrying = run_events([wanted, ...open_then_fail(1, 0)]);
    expect(retrying).toMatchObject({ status: 'connecting', attempt: 2, is_retry: true });

    const fallen_back = run_events(open_then_fail(2, 5_000), retrying);
    expect(fallen_back).toEqual({
      status: 'fallen_back',
      attempt: 2,
      session_id: chat,
      reason: 'error',
    });
    expect(chat_live_socket_target(fallen_back)).toBeUndefined();
    expect(next_chat_live_socket_state(fallen_back, wanted)).toBe(fallen_back);
    expect(run_events([{ type: 'idle' }, wanted], fallen_back)).toMatchObject({
      status: 'connecting',
      attempt: 3,
      is_retry: false,
    });
  });

  it('falls back to the per-run stream when the retry fails too, until the chat goes idle', () => {
    const fallen_back = run_events([
      wanted,
      { type: 'lost', attempt: 1, at: 0, reason: 'error run_stream_ticket_refused' },
      { type: 'lost', attempt: 2, at: 0, reason: 'error run_stream_ticket_refused' },
    ]);
    expect(fallen_back).toEqual({
      status: 'fallen_back',
      attempt: 2,
      session_id: chat,
      reason: 'error run_stream_ticket_refused',
    });
    expect(chat_live_socket_target(fallen_back)).toBeUndefined();
    expect(next_chat_live_socket_state(fallen_back, wanted)).toBe(fallen_back);
    expect(run_events([{ type: 'idle' }, wanted], fallen_back)).toEqual({
      status: 'connecting',
      attempt: 3,
      session_id: chat,
      is_retry: false,
    });
  });

  it('falls back at once where the API runs no queue workers', () => {
    expect(run_events([wanted, { type: 'unavailable', attempt: 1 }])).toEqual({
      status: 'fallen_back',
      attempt: 1,
      session_id: chat,
      reason: 'live stream unavailable',
    });
  });

  it('starts one attempt, so one ticket, for the chat a person switches to', () => {
    const open = run_events([wanted, { type: 'opened', attempt: 1, at: 0 }]);
    const other_chat: ChatLiveSocketEvent = { type: 'wanted', session_id: 'ses_b' };
    const switched = run_events([{ type: 'idle' }, other_chat, other_chat], open);
    expect(switched).toEqual({
      status: 'connecting',
      attempt: 2,
      session_id: 'ses_b',
      is_retry: false,
    });
    expect(chat_live_socket_target(run_events([other_chat], open))).toEqual({
      attempt: 2,
      session_id: 'ses_b',
    });
  });

  it('ignores the events of a socket it already replaced', () => {
    const retrying = run_events([wanted, { type: 'lost', attempt: 1, at: 0, reason: 'error' }]);
    expect(next_chat_live_socket_state(retrying, { type: 'opened', attempt: 1, at: 0 })).toBe(
      retrying,
    );
    expect(
      next_chat_live_socket_state(retrying, { type: 'lost', attempt: 1, at: 0, reason: 'late' }),
    ).toBe(retrying);
    expect(next_chat_live_socket_state(retrying, { type: 'unavailable', attempt: 1 })).toBe(
      retrying,
    );
  });
});
