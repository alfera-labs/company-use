import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { is_chat_run_active, session_status_from_run } from '@/components/app/chat_session_state';
import type { Run, Session } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

/**
 * Keeps the row of the open chat in the chat list saying "Working" for as long as the chat works
 * on a message. A stop writes "Stopped" into the list at once and the list reads itself only
 * while a chat works, so without this the sidebar says "Stopped" while the chat is on the next
 * message. When the work ends with no run to tell the list, the row gets its old state back.
 */
export function useChatListSaysWorking(input: {
  session: Pick<Session, 'session_id' | 'session_status'> | undefined;
  newest_run: Run | undefined;
  is_starting: boolean;
}) {
  const { session, newest_run } = input;
  const is_working = input.is_starting || is_chat_run_active(newest_run?.run_status);
  const query_client = useQueryClient();
  const status_before_ref = useRef<Session['session_status'] | undefined>(undefined);
  const session_id = session?.session_id;
  const listed_status = session?.session_status;
  useEffect(() => {
    if (!session_id || !listed_status) return;
    const show_status = (session_status: Session['session_status']) =>
      query_client.setQueryData<Session[]>(query_keys.sessions(), (sessions) =>
        sessions?.map((item) =>
          item.session_id === session_id ? { ...item, session_status } : item,
        ),
      );
    if (is_working && listed_status !== 'running') {
      status_before_ref.current = listed_status;
      return void show_status('running');
    }
    if (is_working || status_before_ref.current === undefined) return;
    const status_before = status_before_ref.current;
    status_before_ref.current = undefined;
    if (listed_status !== 'running') return;
    show_status((newest_run && session_status_from_run(newest_run)) || status_before);
    void query_client.invalidateQueries({ queryKey: query_keys.sessions() });
  }, [is_working, listed_status, newest_run, query_client, session_id]);
}
