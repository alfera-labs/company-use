import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import { project_is_visible_to_user } from '@coworker/core/db/queries/project_visibility';
import { session_is_visible_to_reader } from '@coworker/core/db/queries/session_participant_visibility';
import { sessions } from '@coworker/core/db/schema';
import { sql } from 'drizzle-orm';

/**
 * Which chats one person may read: the ones in no room, plus the ones in a room they are in.
 * The relational query builder qualifies every column object with the OUTER table's alias,
 * so the inner tables are named literally. Only `sessions.project_id` is a column object.
 *
 * In team mode several people share one install, so a chat in no room is not everybody's:
 * the rule is the one of `session_is_visible_to_reader`, where such a chat is read only by
 * the people in it.
 */
export function visible_to_reader(workspace_id: string, user_id: string) {
  if (is_team_mode_switched_on()) return session_is_visible_to_reader(workspace_id, user_id);
  return sql`(
    ${sessions.project_id} IS NULL
    OR ${project_is_visible_to_user(workspace_id, user_id, sessions.project_id)}
  )`;
}
