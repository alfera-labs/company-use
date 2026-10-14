import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core/db/connection';
import { find_api_key_by_id } from '@coworker/core/db/queries/api_keys';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import { get_user } from '@coworker/core/db/queries/users';

/**
 * In team mode, the own room of the person behind what made a chat: the person, or the person
 * who made the API key. A chat in that room is that person's to read, and nobody else's. No
 * room outside team mode, and none when no person is behind the maker.
 */
export async function find_team_room_of_maker(
  db: Database,
  input: { workspace_id: string; maker_id: string },
): Promise<{ project_id?: string }> {
  if (!is_team_mode_switched_on()) return {};
  const api_key = await find_api_key_by_id(db, input.maker_id);
  const person_id =
    api_key?.workspace_id === input.workspace_id ? api_key.created_by : input.maker_id;
  if (!(await get_user(db, person_id))) return {};
  const room = await open_personal_project(db, {
    workspace_id: input.workspace_id,
    user_id: person_id,
  });
  return { project_id: room.project_id };
}
