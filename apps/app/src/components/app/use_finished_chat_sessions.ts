import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  type FinishedChatSession,
  find_finished_chat_sessions,
} from '@/components/app/finished_chat_sessions';
import { list_sessions, type Session } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export const running_chat_list_poll_ms = 15_000;

export function useFinishedChatSessions(on_finished: (finished: FinishedChatSession[]) => void) {
  const sessions_query = useQuery({
    queryKey: query_keys.sessions(),
    queryFn: list_sessions,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((session) => session.session_status === 'running')
        ? running_chat_list_poll_ms
        : false,
  });

  const previous_sessions = useRef<Session[] | undefined>(undefined);
  const report_finished = useRef(on_finished);
  useEffect(() => {
    report_finished.current = on_finished;
  });

  useEffect(() => {
    const sessions = sessions_query.data;
    if (!sessions) return;

    const finished = find_finished_chat_sessions({
      previous: previous_sessions.current,
      next: sessions,
    });
    previous_sessions.current = sessions;

    if (finished.length > 0) report_finished.current(finished);
  }, [sessions_query.data]);
}
