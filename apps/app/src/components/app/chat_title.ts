import type { Session } from '@/lib/api';

/** The title the API gives a chat until its first message names it. */
export const title_of_a_chat_with_no_name_yet = 'Untitled session';

/** The title of a chat as a person reads it. A chat with no name yet is a new chat. */
export function chat_title(session: Pick<Session, 'session_title'> | undefined) {
  const title = session?.session_title;
  return !title || title === title_of_a_chat_with_no_name_yet ? 'New chat' : title;
}
