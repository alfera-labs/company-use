import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core';
import { find_personal_project } from '@coworker/core/db/queries/personal_projects';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { AppError, is_workspace_administrator_role } from '@coworker/shared';

type Reader = { workspace_id: string; user_id: string };
type Chat = { created_by: string; project_id: string | null };

/**
 * Whether one reader may rename, move or delete a chat they can read.
 *
 * In team mode a chat a person can read and did not start is in a shared place: a project, or
 * a mail thread from outside. A reader who moved it into their own room, or deleted it, would
 * take it from everyone else, and one who renamed it would change the name everyone else
 * finds it by, so there only its maker, an owner or an admin does that. A chat in the reader's
 * own room is read by nobody else, so it is theirs to change whoever started it: the chat of
 * a scheduled task they made is one. Outside team mode any reader does, as before.
 */
export async function read_right_to_move_or_delete_chats(
  db: Database,
  reader: Reader,
): Promise<(chat: Chat) => boolean> {
  if (!is_team_mode_switched_on()) return () => true;
  const [role, own_room] = await Promise.all([
    find_active_workspace_member_role(db, reader),
    find_personal_project(db, reader),
  ]);
  const is_administrator = is_workspace_administrator_role(role);
  return (chat) =>
    is_administrator ||
    chat.created_by === reader.user_id ||
    (chat.project_id !== null && chat.project_id === own_room?.project_id);
}

export async function refuse_a_chat_change_by_a_reader_in_team_mode(
  db: Database,
  input: Reader & { chat: Chat; only_they_can: string },
) {
  if (!is_team_mode_switched_on() || input.chat.created_by === input.user_id) return;
  const may_change = await read_right_to_move_or_delete_chats(db, input);
  if (!may_change(input.chat)) throw new AppError('team_access_denied', input.only_they_can, 403);
}
