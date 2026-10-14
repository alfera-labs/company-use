import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core';
import { get_file } from '@coworker/core/db/queries/files';
import { get_run_for_user } from '@coworker/core/db/queries/run_for_user';
import { get_session_for_user } from '@coworker/core/db/queries/sessions';
import { NotFoundError } from '@coworker/shared';

type Person = { workspace_id: string; user_id: string };

/**
 * Team mode keeps what belongs to one chat to the people who read that chat, also on the
 * routes that reach it by an id and not through the chat itself. Outside team mode each of
 * these checks nothing and changes nothing.
 */
export async function require_chat_person_reads(
  db: Database,
  person: Person,
  session_id: string,
): Promise<void> {
  if (!is_team_mode_switched_on()) return;
  if (!(await get_session_for_user(db, { ...person, session_id }))) {
    throw new NotFoundError('Session');
  }
}

/** An upload made in a chat or a run is copied elsewhere only by a person who reads that chat. */
export async function require_upload_person_reads(
  db: Database,
  person: Person,
  file_id: string,
): Promise<void> {
  if (!is_team_mode_switched_on()) return;
  const file = await get_file(db, person.workspace_id, file_id);
  if (file?.session_id) await require_chat_person_reads(db, person, file.session_id);
  else if (file?.run_id && !(await get_run_for_user(db, { ...person, run_id: file.run_id }))) {
    throw new NotFoundError('File');
  }
}
