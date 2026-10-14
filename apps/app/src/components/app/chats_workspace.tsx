import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback } from 'react';
import { ChatSessionView } from '@/components/app/chat_session_view';
import { EmptyNote } from '@/components/app/empty_note';
import { use_chat_is_not_this_persons } from '@/components/app/use_team_mode';
import { list_sessions } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function ChatsWorkspace() {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const selected_session_id = typeof params.session_id === 'string' ? params.session_id : undefined;

  const sessions_query = useQuery({
    queryFn: list_sessions,
    queryKey: query_keys.sessions(),
    select: (sessions) => sessions.find((session) => session.session_id === selected_session_id),
  });
  const selected_session = sessions_query.data;
  const open_ready_session = useCallback(
    (session_id: string) => navigate({ href: `/chats/${session_id}`, replace: true }),
    [navigate],
  );
  const chat_is_not_this_persons = use_chat_is_not_this_persons(
    selected_session_id,
    sessions_query.isSuccess && !selected_session,
  );

  return (
    <div className="flex h-full min-h-0 bg-background md:h-screen">
      {chat_is_not_this_persons ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyNote>This chat is not yours or does not exist.</EmptyNote>
        </div>
      ) : (
        <ChatSessionView
          {...(selected_session ? { selectedSession: selected_session } : {})}
          {...(selected_session_id ? { selectedSessionId: selected_session_id } : {})}
          onSessionReady={open_ready_session}
        />
      )}
    </div>
  );
}
