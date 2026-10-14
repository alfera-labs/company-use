import type { Session } from '@/lib/api';

export type FinishedChatSession = {
  session_id: string;
  session_title: string;
  outcome: 'completed' | 'failed' | 'cancelled';
};

const finished_session_outcomes: Record<string, FinishedChatSession['outcome']> = {
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export function find_finished_chat_sessions(input: {
  previous: Session[] | undefined;
  next: Session[] | undefined;
}): FinishedChatSession[] {
  if (!input.previous || !input.next) return [];

  const was_running = new Set(
    input.previous
      .filter((session) => session.session_status === 'running')
      .map((session) => session.session_id),
  );

  const finished: FinishedChatSession[] = [];
  for (const session of input.next) {
    if (!was_running.has(session.session_id) || is_task_chat(session)) continue;
    const outcome = finished_session_outcomes[session.session_status ?? ''];
    if (!outcome) continue;
    finished.push({
      session_id: session.session_id,
      session_title: session.session_title ?? 'Untitled chat',
      outcome,
    });
  }
  return finished;
}

function is_task_chat(session: Session) {
  return session.session_source === 'trigger';
}

export function describe_finished_chat_session(session: FinishedChatSession) {
  return {
    title: session.session_title,
    body: finished_session_bodies[session.outcome],
  };
}

const finished_session_bodies: Record<FinishedChatSession['outcome'], string> = {
  completed: 'Finished — your answer is ready.',
  failed: 'Stopped early and could not finish.',
  cancelled: 'Cancelled before it finished.',
};
