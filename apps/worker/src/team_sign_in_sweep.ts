import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core';
import { delete_expired_team_sessions } from '@coworker/core/db/queries/team_sessions';
import { delete_finished_team_sign_in_links } from '@coworker/core/db/queries/team_sign_in_links';

/**
 * Removes the sessions that ran out and the links that were used or ran out. Only a team-mode
 * install has such rows, so every other install asks the database nothing.
 */
export async function sweep_finished_team_sign_ins(db: Database): Promise<void> {
  if (!is_team_mode_switched_on()) return;
  await Promise.all([delete_expired_team_sessions(db), delete_finished_team_sign_in_links(db)]);
}
