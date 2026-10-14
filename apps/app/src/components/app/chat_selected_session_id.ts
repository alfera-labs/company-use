import type { Session } from '@/lib/api';

/** The id of the chat on screen: the one of the loaded chat, or else the one in the address. */
export function selected_chat_session_id(input: {
  selectedSession?: Pick<Session, 'session_id'>;
  selectedSessionId?: string;
}) {
  return input.selectedSession?.session_id ?? input.selectedSessionId;
}
