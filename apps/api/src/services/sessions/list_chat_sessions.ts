import { read_right_to_move_or_delete_chats } from '@api/services/sessions/chat_change_right';
import type { Database } from '@coworker/core';
import { find_visible_project } from '@coworker/core/db/queries/project_visibility';
import { list_sessions_with_latest_activity } from '@coworker/core/db/queries/session_list';
import { session_is_unread } from '@coworker/core/db/queries/session_read_markers';
import { NotFoundError } from '@coworker/shared';

type ListedSession = Awaited<ReturnType<typeof list_sessions_with_latest_activity>>[number];

const run_statuses_that_need_the_person = ['waiting', 'failed'];

function chat_is_unread(session: ListedSession, reader_id: string) {
  const has_unseen_messages = session_is_unread(session.session_metadata, {
    reader_id,
    newest_sequence: session.newest_sequence,
  });
  if (session.session_source !== 'trigger') return has_unseen_messages;
  const latest_run_status = session.latest_run?.run_status ?? '';
  return has_unseen_messages && run_statuses_that_need_the_person.includes(latest_run_status);
}

export async function list_chat_sessions(
  db: Database,
  input: { workspace_id: string; user_id: string; project_id?: string | undefined },
) {
  const { workspace_id, user_id: reader_id, project_id } = input;
  const [project, reader_may_move_or_delete, sessions] = await Promise.all([
    project_id ? find_visible_project(db, { workspace_id, project_id, user_id: reader_id }) : null,
    read_right_to_move_or_delete_chats(db, { workspace_id, user_id: reader_id }),
    list_sessions_with_latest_activity(db, workspace_id, {
      ...(project_id ? { project_id } : {}),
      visible_to_user_id: reader_id,
      hide_system_trigger_sessions: true,
    }),
  ]);
  if (project_id && !project) throw new NotFoundError('Project');
  return sessions.map((session) => ({
    ...session,
    is_unread: chat_is_unread(session, reader_id),
    reader_may_move_or_delete_it: reader_may_move_or_delete(session),
  }));
}
