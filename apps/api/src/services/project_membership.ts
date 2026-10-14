import type { GranteeType, GrantLevel } from '@coworker/core/access/may_use_resource';
import type { Database } from '@coworker/core/db/connection';
import { set_project_member } from '@coworker/core/db/queries/project_members';
import { get_agent } from '@coworker/core/db/queries/sessions';
import { workspace_member_is_active } from '@coworker/core/db/queries/workspace_membership';
import { ValidationError } from '@coworker/shared';

type AddProjectMemberInput = {
  workspace_id: string;
  project_id: string;
  grantee_type: Extract<GranteeType, 'user' | 'agent'>;
  grantee_id: string;
  grant_level: GrantLevel;
  actor_id: string;
};

export async function add_project_member(db: Database, input: AddProjectMemberInput) {
  await validate_project_member(db, input);
  return set_project_member(db, input);
}

async function validate_project_member(db: Database, input: AddProjectMemberInput) {
  if (input.grantee_type === 'user') {
    const is_active = await workspace_member_is_active(db, {
      workspace_id: input.workspace_id,
      user_id: input.grantee_id,
    });
    if (!is_active) throw new ValidationError('The user is not an active workspace member.');
    return;
  }

  const agent = await get_agent(db, input.workspace_id, input.grantee_id);
  if (!agent || agent.agent_status !== 'active') {
    throw new ValidationError('The agent is not active in this workspace.');
  }
}
