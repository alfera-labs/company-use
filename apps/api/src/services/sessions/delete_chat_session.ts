import { refuse_a_chat_change_by_a_reader_in_team_mode } from '@api/services/sessions/chat_change_right';
import type { Database } from '@coworker/core';
import { archive_session, type get_session } from '@coworker/core/db/queries/sessions';

type ChatSession = NonNullable<Awaited<ReturnType<typeof get_session>>>;

const only_they_can_delete_it =
  'Only the person who started this chat, or an owner or an admin, can delete it.';

/** Takes a chat out of every chat list. Who may do that: see `chat_change_right`. */
export async function delete_chat_session(
  db: Database,
  input: { workspace_id: string; user_id: string; chat: ChatSession },
) {
  await refuse_a_chat_change_by_a_reader_in_team_mode(db, {
    ...input,
    only_they_can: only_they_can_delete_it,
  });
  return archive_session(db, {
    workspace_id: input.workspace_id,
    session_id: input.chat.session_id,
    actor_id: input.user_id,
  });
}
