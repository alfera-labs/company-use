import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { read_desktop_notifications_enabled } from '@/components/app/desktop_notification_storage';
import { show_desktop_notification } from '@/components/app/desktop_notifications';
import {
  describe_finished_chat_session,
  type FinishedChatSession,
} from '@/components/app/finished_chat_sessions';
import { useFinishedChatSessions } from '@/components/app/use_finished_chat_sessions';

export function RunCompletionNotifier() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const open_session_id = useRef<string | undefined>(undefined);

  useEffect(() => {
    open_session_id.current = pathname.startsWith('/chats/') ? pathname.split('/')[2] : undefined;
  }, [pathname]);

  useFinishedChatSessions((finished) => {
    if (!read_desktop_notifications_enabled()) return;
    for (const session of finished) {
      if (is_already_on_screen(session, open_session_id.current)) continue;
      notify_finished_chat_session(session, navigate);
    }
  });

  return null;
}

function is_already_on_screen(session: FinishedChatSession, open_session_id: string | undefined) {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && open_session_id === session.session_id;
}

function notify_finished_chat_session(
  session: FinishedChatSession,
  navigate: ReturnType<typeof useNavigate>,
) {
  const notice = describe_finished_chat_session(session);
  show_desktop_notification({
    title: notice.title,
    body: notice.body,
    tag: `chat-${session.session_id}`,
    on_click: () => navigate({ href: `/chats/${session.session_id}` }),
  });
}
