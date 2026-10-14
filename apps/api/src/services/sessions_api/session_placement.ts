import { list_connections_lost_by_move } from '@api/services/connections/connections_lost_by_move';
import { refuse_a_move_that_shares_a_chat_without_a_yes } from '@api/services/sessions/chat_move_that_shares';
import type { PublicSession } from '@api/services/sessions_api/public_session';
import {
  get_api_session,
  require_owned_api_session,
} from '@api/services/sessions_api/session_reads';
import type { Database } from '@coworker/core';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { find_visible_project } from '@coworker/core/db/queries/project_visibility';
import { move_session_to_project } from '@coworker/core/db/queries/session_placement';
import { NotFoundError } from '@coworker/shared';

export type MovedSession = PublicSession & { connections_lost: string[] };

export async function move_api_session(
  db: Database,
  api_key: ApiKey,
  input: {
    session_id: string;
    project_id: string | null;
    share_with_its_readers?: true | undefined;
  },
): Promise<MovedSession> {
  const before = await require_owned_api_session(db, api_key, input.session_id);
  const target = input.project_id
    ? await find_visible_project(db, {
        workspace_id: api_key.workspace_id,
        project_id: input.project_id,
        user_id: api_key.api_key_id,
      })
    : null;
  if (input.project_id && !target) throw new NotFoundError('Project');
  await refuse_a_move_that_shares_a_chat_without_a_yes(db, {
    workspace_id: api_key.workspace_id,
    from_project_id: before.project_id,
    target,
    share_with_its_readers: input.share_with_its_readers,
  });
  const after = await move_session_to_project(db, {
    workspace_id: api_key.workspace_id,
    session_id: input.session_id,
    project_id: input.project_id,
    actor_id: api_key.api_key_id,
  });
  const connections_lost = await list_connections_lost_by_move(db, {
    workspace_id: api_key.workspace_id,
    before,
    after,
  });
  return {
    ...(await get_api_session(db, api_key, input.session_id)),
    connections_lost,
  };
}
