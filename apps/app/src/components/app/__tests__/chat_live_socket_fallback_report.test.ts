import { afterEach, describe, expect, it, vi } from 'vitest';
import { report_live_socket_fallback } from '@/components/app/chat_live_socket_fallback_report';
import {
  initial_chat_live_socket_state,
  next_chat_live_socket_state,
} from '@/components/app/chat_live_socket_state';

afterEach(() => {
  vi.restoreAllMocks();
});

function reason_after_the_install_offers_no_live_stream() {
  const connecting = next_chat_live_socket_state(initial_chat_live_socket_state, {
    type: 'wanted',
    session_id: 'ses_1',
  });
  const state = next_chat_live_socket_state(connecting, {
    type: 'unavailable',
    attempt: connecting.attempt,
  });
  return state.status === 'fallen_back' ? state.reason : 'not fallen back';
}

describe('the chat falling back from the live socket', () => {
  it('says nothing in the console when the install offers no live stream', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    report_live_socket_fallback(reason_after_the_install_offers_no_live_stream());

    expect(warn).not.toHaveBeenCalled();
  });

  it('still reports a live socket that was open and got lost', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    report_live_socket_fallback('closed and not reopened in 3 s');

    expect(warn).toHaveBeenCalledWith(
      '[chat live socket] using the per-run stream and polls: closed and not reopened in 3 s',
    );
  });
});
