import { describe, expect, it } from 'vitest';
import {
  describe_finished_chat_session,
  find_finished_chat_sessions,
} from '@/components/app/finished_chat_sessions';
import type { Session } from '@/lib/api';

function session(input: { id: string; status: string; title?: string; source?: string }): Session {
  return {
    session_id: input.id,
    session_status: input.status,
    session_title: input.title ?? `Chat ${input.id}`,
    session_source: input.source ?? 'dashboard',
  } as unknown as Session;
}

describe('find_finished_chat_sessions', () => {
  it('reports a chat that stopped running between two polls', () => {
    const finished = find_finished_chat_sessions({
      previous: [session({ id: 's1', status: 'running', title: 'Weekly report' })],
      next: [session({ id: 's1', status: 'completed', title: 'Weekly report' })],
    });

    expect(finished).toEqual([
      { session_id: 's1', session_title: 'Weekly report', outcome: 'completed' },
    ]);
  });

  it('reports failed and cancelled runs, not just successful ones', () => {
    const finished = find_finished_chat_sessions({
      previous: [
        session({ id: 's1', status: 'running' }),
        session({ id: 's2', status: 'running' }),
      ],
      next: [session({ id: 's1', status: 'failed' }), session({ id: 's2', status: 'cancelled' })],
    });

    expect(finished.map((item) => item.outcome)).toEqual(['failed', 'cancelled']);
  });

  it('reports nothing on the first poll, when every running chat would look new', () => {
    const finished = find_finished_chat_sessions({
      previous: undefined,
      next: [session({ id: 's1', status: 'completed' })],
    });

    expect(finished).toEqual([]);
  });

  it('does not report a chat that was already finished before this poll', () => {
    const finished = find_finished_chat_sessions({
      previous: [session({ id: 's1', status: 'completed' })],
      next: [session({ id: 's1', status: 'completed' })],
    });

    expect(finished).toEqual([]);
  });

  it('does not report a chat that is still running', () => {
    const finished = find_finished_chat_sessions({
      previous: [session({ id: 's1', status: 'running' })],
      next: [session({ id: 's1', status: 'running' })],
    });

    expect(finished).toEqual([]);
  });

  it('does not report a task chat, whose run nobody is waiting on', () => {
    const finished = find_finished_chat_sessions({
      previous: [
        session({ id: 's1', status: 'running', source: 'trigger' }),
        session({ id: 's2', status: 'running', source: 'trigger' }),
        session({ id: 's3', status: 'running', source: 'slack' }),
      ],
      next: [
        session({ id: 's1', status: 'completed', source: 'trigger' }),
        session({ id: 's2', status: 'failed', source: 'trigger' }),
        session({ id: 's3', status: 'completed', source: 'slack' }),
      ],
    });

    expect(finished.map((item) => item.session_id)).toEqual(['s3']);
  });

  it('names an untitled chat rather than reporting an empty notification', () => {
    const untitled = { session_id: 's1', session_status: 'completed' } as unknown as Session;

    const finished = find_finished_chat_sessions({
      previous: [session({ id: 's1', status: 'running' })],
      next: [untitled],
    });

    expect(finished[0]?.session_title).toBe('Untitled chat');
  });
});

describe('describe_finished_chat_session', () => {
  it('names the chat in the title so the notification says which one wants you', () => {
    const notice = describe_finished_chat_session({
      session_id: 's1',
      session_title: 'Weekly report',
      outcome: 'completed',
    });

    expect(notice.title).toBe('Weekly report');
    expect(notice.body).toBe('Finished — your answer is ready.');
  });

  it('does not claim a failed run produced an answer', () => {
    const notice = describe_finished_chat_session({
      session_id: 's1',
      session_title: 'Weekly report',
      outcome: 'failed',
    });

    expect(notice.body).toBe('Stopped early and could not finish.');
  });
});
