import { find_grant_level } from '@coworker/core/access/may_use_resource';
import type { Database } from '@coworker/core/db/connection';
import { list_project_members } from '@coworker/core/db/queries/project_members';
import { read_grant_rules } from '@coworker/core/db/queries/resource_grants';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { AppError, is_workspace_administrator_role } from '@coworker/shared';

export async function assert_project_manager(
  db: Database,
  input: { workspace_id: string; project_id: string; user_id: string },
): Promise<void> {
  if (await project_is_manageable_by_user(db, input)) return;

  throw new AppError(
    'project_access_denied',
    'Only a manager of this project, or a workspace owner or admin, can change it.',
    403,
  );
}

export async function project_is_manageable_by_user(
  db: Database,
  input: { workspace_id: string; project_id: string; user_id: string },
): Promise<boolean> {
  if (await is_workspace_administrator(db, input)) return true;

  const members = await list_project_members(db, {
    workspace_id: input.workspace_id,
    project_id: input.project_id,
  });
  return find_grant_level(read_grant_rules(members), 'user', input.user_id) === 'manage';
}

export async function assert_workspace_administrator(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<void> {
  if (await is_workspace_administrator(db, input)) return;
  throw new AppError(
    'workspace_access_denied',
    'Only a workspace owner or admin can change who uses a resource.',
    403,
  );
}

export async function is_workspace_administrator(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<boolean> {
  const role = await find_active_workspace_member_role(db, {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
  });
  return is_workspace_administrator_role(role);
}
