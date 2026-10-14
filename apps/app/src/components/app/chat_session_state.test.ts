import { describe, expect, it } from 'vitest';
import {
  has_newly_connected_app,
  is_chat_run_active,
  is_chat_run_terminal,
  should_keep_chat_submitting,
  should_show_chat_session_loading,
} from '@/components/app/chat_session_state';

describe('chat session state', () => {
  it('treats every backend-cancellable run status as active', () => {
    for (const latestRunStatus of ['queued', 'starting', 'running', 'waiting']) {
      expect(is_chat_run_active(latestRunStatus)).toBe(true);
      expect(
        should_keep_chat_submitting({
          isMutationPending: false,
          latestRunStatus,
          selectedSessionStatus: 'active',
        }),
      ).toBe(true);
    }
  });

  it('treats completed runs as terminal even while stale submit/session flags remain true', () => {
    expect(is_chat_run_active('completed')).toBe(false);
    expect(is_chat_run_terminal('completed')).toBe(true);
    expect(
      should_keep_chat_submitting({
        isMutationPending: true,
        latestRunStatus: 'completed',
        selectedSessionStatus: 'running',
      }),
    ).toBe(false);
  });

  it('keeps the working indicator visible for the whole active run, even once output exists', () => {
    expect(
      should_keep_chat_submitting({
        isMutationPending: true,
        selectedSessionStatus: 'active',
      }),
    ).toBe(true);
    expect(
      should_keep_chat_submitting({
        isMutationPending: true,
        latestRunStatus: 'running',
        selectedSessionStatus: 'running',
      }),
    ).toBe(true);
  });

  it('keeps working from the moment a follow-up is sent, before its run row exists', () => {
    expect(
      should_keep_chat_submitting({
        isMutationPending: true,
        latestRunStartedThisSend: false,
        latestRunStatus: 'completed',
        selectedSessionStatus: 'completed',
      }),
    ).toBe(true);
    expect(
      should_keep_chat_submitting({
        isMutationPending: true,
        latestRunStartedThisSend: false,
        latestRunStatus: 'cancelled',
      }),
    ).toBe(true);
    expect(
      should_keep_chat_submitting({
        isMutationPending: true,
        latestRunStartedThisSend: true,
        latestRunStatus: 'completed',
      }),
    ).toBe(false);
  });

  it('keeps working after the send returns, while the sent message waits for its run', () => {
    const after_send = { isMutationPending: false, latestRunStartedThisSend: false };
    expect(
      should_keep_chat_submitting({
        ...after_send,
        isMessageWaitingToStart: true,
        latestRunStatus: 'completed',
      }),
    ).toBe(true);
    expect(
      should_keep_chat_submitting({
        ...after_send,
        isMessageWaitingToStart: false,
        latestRunStatus: 'completed',
      }),
    ).toBe(false);
  });

  it('opens the resumed-run watch when a connection lands, not on the first connections answer', () => {
    const before = { linear: 1_000 };
    expect(has_newly_connected_app(undefined, before)).toBe(false);
    expect(has_newly_connected_app(before, undefined)).toBe(false);
    expect(has_newly_connected_app(before, { linear: 1_000 })).toBe(false);
    expect(has_newly_connected_app(before, { linear: 1_000, notion: 2_000 })).toBe(true);
    expect(has_newly_connected_app(before, { linear: 2_000 })).toBe(true);
  });

  it('does not open the watch when a connection is removed', () => {
    expect(has_newly_connected_app({ linear: 1_000, notion: 2_000 }, { linear: 1_000 })).toBe(
      false,
    );
  });

  it('shows a session skeleton while a selected chat loads its first messages', () => {
    expect(
      should_show_chat_session_loading({
        isMessagesLoading: true,
        isMutationPending: false,
        messageCount: 0,
        sessionId: 'session_1',
      }),
    ).toBe(true);
  });

  it('keeps the session skeleton off for new chats, optimistic sends, and loaded sessions', () => {
    expect(
      should_show_chat_session_loading({
        isMessagesLoading: true,
        isMutationPending: false,
        messageCount: 0,
      }),
    ).toBe(false);
    expect(
      should_show_chat_session_loading({
        isMessagesLoading: true,
        isMutationPending: true,
        messageCount: 0,
        sessionId: 'session_1',
      }),
    ).toBe(false);
    expect(
      should_show_chat_session_loading({
        isMessagesLoading: false,
        isMutationPending: false,
        messageCount: 0,
        sessionId: 'session_1',
      }),
    ).toBe(false);
    expect(
      should_show_chat_session_loading({
        isMessagesLoading: true,
        isMutationPending: false,
        messageCount: 1,
        sessionId: 'session_1',
      }),
    ).toBe(false);
  });
});
