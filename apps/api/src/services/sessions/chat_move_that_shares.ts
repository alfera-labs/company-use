import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core';
import type { ProjectRow } from '@coworker/core/db/queries/projects';
import { find_workspace_profile } from '@coworker/core/db/queries/workspace_provisioning';
import { AppError } from '@coworker/shared';
import { z } from 'zod';

/** The yes a request gives to a move that lets other people read the chat. */
export const share_with_its_readers_schema = z.literal(true).optional();

type ChatMove = {
  workspace_id: string;
  from_project_id: string | null;
  target: ProjectRow | null;
  share_with_its_readers: true | undefined;
};

/**
 * In team mode a chat is read only by its own people until it is moved into a project other
 * people read. That move hands them every message of it, so the request must say yes to it
 * first. A move into a person's own room, or out of every project, shares nothing and needs
 * no yes. Outside team mode nothing is asked, as before.
 */
export async function refuse_a_move_that_shares_a_chat_without_a_yes(db: Database, move: ChatMove) {
  if (!is_team_mode_switched_on() || move.share_with_its_readers) return;
  const { target } = move;
  if (!target || target.personal_for_user_id) return;
  if (target.project_id === move.from_project_id) return;
  const who_will_read_it = await words_for_who_will_read_it(db, target);
  throw new AppError(
    'chat_move_shares_the_chat',
    `${who_will_read_it} To move it, send "share_with_its_readers": true.`,
    409,
  );
}

async function words_for_who_will_read_it(db: Database, target: ProjectRow) {
  if (target.project_access !== 'workspace') {
    return `Everyone in the project ${target.project_name} will be able to read this chat.`;
  }
  const workspace = await find_workspace_profile(db, target.workspace_id);
  return `Everyone in ${workspace?.workspace_name ?? 'the workspace'} will be able to read this chat.`;
}
