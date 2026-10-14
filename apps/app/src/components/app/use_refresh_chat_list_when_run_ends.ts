import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { is_chat_run_active, session_status_from_run } from '@/components/app/chat_session_state';
import type { Run, Session } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

/**
 * Tells the chat list that the newest run of the open chat ended, at the moment the chat sees it.
 * The list reads itself only every few seconds, so without this the sidebar says "Working" for a
 * while after the answer is on the screen.
 */
export function useRefreshChatListWhenRunEnds(run: Run | undefined) {
  const query_client = useQueryClient();
  const active_run_id_ref = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!run) return;
    if (is_chat_run_active(run.run_status)) {
      active_run_id_ref.current = run.run_id;
      return;
    }
    if (active_run_id_ref.current !== run.run_id) return;
    active_run_id_ref.current = undefined;
    const session_status = session_status_from_run(run);
    query_client.setQueryData<Session[]>(query_keys.sessions(), (sessions) =>
      sessions?.map((session) =>
        session.session_id === run.session_id
          ? {
              ...session,
              ...(session_status ? { session_status } : {}),
              latest_run: session.latest_run
                ? { ...session.latest_run, run_id: run.run_id, run_status: run.run_status }
                : session.latest_run,
            }
          : session,
      ),
    );
    void query_client.invalidateQueries({ queryKey: query_keys.sessions() });
  }, [query_client, run]);
}
