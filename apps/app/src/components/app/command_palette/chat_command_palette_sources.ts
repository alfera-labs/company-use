import { MessageSquare, MessagesSquare } from 'lucide-react';
import type {
  CommandPaletteMatch,
  CommandPaletteSource,
} from '@/components/app/command_palette/command_palette_source';
import {
  find_sessions_matching_title,
  read_session_title,
  split_title_into_runs,
} from '@/components/app/command_palette/match_chat_titles';
import { relative_time, type Session, search_session_messages } from '@/lib/api';

export function create_chat_command_palette_sources(input: {
  sessions: readonly Session[];
  open_chat: (session_id: string) => void;
}): CommandPaletteSource[] {
  return [
    {
      source_id: 'chat_titles',
      group_label: 'Chats',
      resolves_from: 'local',
      find_matches: ({ query_text }) =>
        find_sessions_matching_title(input.sessions, query_text).map((session) =>
          title_match(session, query_text, input.open_chat),
        ),
    },
    {
      source_id: 'chat_messages',
      group_label: 'Chats',
      resolves_from: 'remote',
      find_matches: async ({ query_text, signal }) => {
        const matches = await search_session_messages(query_text, signal);
        return matches.map((match) => ({
          match_id: `chat:${match.session_id}`,
          title_runs: split_title_into_runs(match.session_title ?? 'Untitled chat', query_text),
          detail_runs: match.snippet_runs,
          ...(match.last_message_time
            ? { date_label: relative_time(match.last_message_time) }
            : {}),
          icon: MessagesSquare,
          open_match: () => input.open_chat(match.session_id),
        }));
      },
    },
  ];
}

function title_match(
  session: Session,
  query_text: string,
  open_chat: (session_id: string) => void,
): CommandPaletteMatch {
  const title = read_session_title(session);
  return {
    match_id: `chat:${session.session_id}`,
    title_runs: split_title_into_runs(title, query_text),
    ...(session.last_message_time ? { date_label: relative_time(session.last_message_time) } : {}),
    icon: MessageSquare,
    open_match: () => open_chat(session.session_id),
  };
}
