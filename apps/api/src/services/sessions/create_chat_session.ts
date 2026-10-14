import type { Database } from '@coworker/core';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import { find_visible_project } from '@coworker/core/db/queries/project_visibility';
import { create_session_in_personal_project } from '@coworker/core/db/queries/session_values';
import { create_session } from '@coworker/core/db/queries/sessions';
import { NotFoundError } from '@coworker/shared';

type CreateChatSessionInput = {
  workspace_id: string;
  agent_id: string;
  user_id: string;
  project_id?: string;
  session_title?: string;
};

export async function create_chat_session(db: Database, input: CreateChatSessionInput) {
  const { user_id, project_id, ...session } = input;
  const owner = { workspace_id: input.workspace_id, user_id };
  const session_input = { ...session, actor_id: user_id };
  if (project_id) {
    const project = await find_visible_project(db, { ...owner, project_id });
    if (!project) throw new NotFoundError('Project');
    return create_session(db, { ...session_input, project_id: project.project_id });
  }
  const created = await create_session_in_personal_project(db, { ...session_input, user_id });
  if (created) return created;
  const personal_project = await open_personal_project(db, owner);
  return create_session(db, { ...session_input, project_id: personal_project.project_id });
}
