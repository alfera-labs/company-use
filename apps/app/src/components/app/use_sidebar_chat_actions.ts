import { format_error_message } from '@coworker/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { delete_chat, type Session } from '@/lib/api';
import { move_chat_to_project, rename_chat } from '@/lib/api/chat_updates';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

export function chats_after_rename(chats: Session[], session_id: string, session_title: string) {
  return chats.map((chat) => (chat.session_id === session_id ? { ...chat, session_title } : chat));
}

export function chats_after_move(chats: Session[], session_id: string, project_id: string) {
  return chats.map((chat) => (chat.session_id === session_id ? { ...chat, project_id } : chat));
}

/** A name a person typed, ready to save. Null when it is empty or is the name the chat has. */
export function name_to_save(typed_name: string, current_name: string | null) {
  const name = typed_name.trim().slice(0, 160);
  return name && name !== current_name ? name : null;
}

async function show_then_save(
  query_client: QueryClient,
  change: (chats: Session[]) => Session[],
  save: () => Promise<unknown>,
  not_saved_words?: string,
) {
  const previous = query_client.getQueryData<Session[]>(query_keys.sessions());
  query_client.setQueryData<Session[]>(query_keys.sessions(), (chats) => change(chats ?? []));
  try {
    await save();
  } catch (error) {
    query_client.setQueryData(query_keys.sessions(), previous);
    if (not_saved_words) toast.error(format_error_message(error, not_saved_words));
    return;
  }
  await query_client.invalidateQueries({ queryKey: query_keys.sessions() });
}

async function move_and_say_what_it_costs(
  session_id: string,
  project: Project,
  shares_it: boolean,
) {
  const moved = await move_chat_to_project(session_id, project.project_id, shares_it);
  if (moved.connections_lost.length === 0) return;
  toast.message(`In this project the chat can no longer use ${moved.connections_lost.join(', ')}.`);
}

/**
 * The three changes a person makes to a chat from its sidebar row. Each shows at once. A
 * reader the API would refuse gets none of them, so the row offers no change at all.
 */
export function useSidebarChatActions(session: Session, is_open_chat: boolean) {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const { session_id } = session;
  const changes = {
    delete_this_chat() {
      if (is_open_chat) navigate({ href: '/chats' });
      return show_then_save(
        query_client,
        (chats) => chats.filter((chat) => chat.session_id !== session_id),
        () => delete_chat(session_id),
      );
    },
    rename_this_chat(typed_name: string) {
      const name = name_to_save(typed_name, session.session_title);
      if (!name) return;
      return show_then_save(
        query_client,
        (chats) => chats_after_rename(chats, session_id, name),
        () => rename_chat(session_id, name),
        'The chat was not renamed.',
      );
    },
    move_this_chat(project: Project, shares_it = false) {
      return show_then_save(
        query_client,
        (chats) => chats_after_move(chats, session_id, project.project_id),
        () => move_and_say_what_it_costs(session_id, project, shares_it),
        'The chat was not moved.',
      );
    },
  };
  return session.reader_may_move_or_delete_it === false ? null : changes;
}
