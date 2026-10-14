import { list_connections_lost_by_move } from '@api/services/connections/connections_lost_by_move';
import { refuse_a_chat_change_by_a_reader_in_team_mode } from '@api/services/sessions/chat_change_right';
import {
  refuse_a_move_that_shares_a_chat_without_a_yes,
  share_with_its_readers_schema,
} from '@api/services/sessions/chat_move_that_shares';
import type { Database } from '@coworker/core';
import { find_visible_project } from '@coworker/core/db/queries/project_visibility';
import { move_session_to_project } from '@coworker/core/db/queries/session_placement';
import { rename_session } from '@coworker/core/db/queries/session_title';
import type { get_session } from '@coworker/core/db/queries/sessions';
import { NotFoundError } from '@coworker/shared';
import { z } from 'zod';

export const chat_session_update_schema = z.union([
  z
    .object({
      project_id: z.string().min(1).nullable(),
      share_with_its_readers: share_with_its_readers_schema,
    })
    .strict(),
  z.object({ session_title: z.string().trim().min(1).max(160) }).strict(),
]);

type ChatSession = NonNullable<Awaited<ReturnType<typeof get_session>>>;

type ChatSessionUpdate = {
  workspace_id: string;
  user_id: string;
  before: ChatSession;
  update: z.infer<typeof chat_session_update_schema>;
};

const only_they_can_move_it =
  'Only the person who started this chat, or an owner or an admin, can move it.';
const only_they_can_rename_it =
  'Only the person who started this chat, or an owner or an admin, can rename it.';

/**
 * Renames a chat, or moves it into a project and names the connections the move costs it.
 * Who may rename or move it: see `chat_change_right`. What a move must say first: see
 * `chat_move_that_shares`.
 */
export async function update_chat_session(db: Database, input: ChatSessionUpdate) {
  const { update } = input;
  if ('session_title' in update) {
    await refuse_a_chat_change_by_a_reader_in_team_mode(db, {
      ...input,
      chat: input.before,
      only_they_can: only_they_can_rename_it,
    });
    return rename_session(db, {
      workspace_id: input.workspace_id,
      session_id: input.before.session_id,
      session_title: update.session_title,
      actor_id: input.user_id,
    });
  }
  return move_chat_session(db, input, update);
}

async function move_chat_session(
  db: Database,
  input: ChatSessionUpdate,
  move: { project_id: string | null; share_with_its_readers?: true | undefined },
) {
  const { project_id } = move;
  await refuse_a_chat_change_by_a_reader_in_team_mode(db, {
    ...input,
    chat: input.before,
    only_they_can: only_they_can_move_it,
  });
  const target = project_id
    ? await find_visible_project(db, {
        workspace_id: input.workspace_id,
        project_id,
        user_id: input.user_id,
      })
    : null;
  if (project_id && !target) throw new NotFoundError('Project');
  await refuse_a_move_that_shares_a_chat_without_a_yes(db, {
    workspace_id: input.workspace_id,
    from_project_id: input.before.project_id,
    target,
    share_with_its_readers: move.share_with_its_readers,
  });
  const session = await move_session_to_project(db, {
    workspace_id: input.workspace_id,
    session_id: input.before.session_id,
    project_id,
    actor_id: input.user_id,
  });
  const connections_lost = await list_connections_lost_by_move(db, {
    workspace_id: input.workspace_id,
    before: input.before,
    after: session,
  });
  return { ...session, connections_lost };
}
