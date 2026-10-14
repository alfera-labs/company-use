import type { Database } from '@coworker/core';
import { find_project } from '@coworker/core/db/queries/projects';
import { get_session } from '@coworker/core/db/queries/sessions';
import { count_active_workspace_members } from '@coworker/core/services/workspace_plan';
import { type RunAudience, read_room_audience } from '@runtime-platform/orchestrator/run_audience';

/**
 * The audience of a session's runs, read again from the session and its project. Work that runs
 * outside the live run (an approved call caught up later) uses it so a narrow chat stays narrow.
 * A session that is gone is narrow.
 */
export async function read_session_run_audience(
  db: Database,
  input: { workspace_id: string; session_id: string },
): Promise<RunAudience> {
  const session = await get_session(db, input.workspace_id, input.session_id);
  if (!session) return 'narrow';
  const [project, workspace_member_count] = await Promise.all([
    session.project_id
      ? find_project(db, { workspace_id: input.workspace_id, project_id: session.project_id })
      : null,
    count_active_workspace_members(db, input.workspace_id),
  ]);
  return read_room_audience(session, project, workspace_member_count).run_audience;
}
