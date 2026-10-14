import type { ApiEnv } from '@api/lib/context';
import { assert_project_manager } from '@coworker/core/access/assert_project_manager';
import { find_visible_project } from '@coworker/core/db/queries/project_visibility';
import { NotFoundError } from '@coworker/shared';
import type { Context } from 'hono';

export async function read_project_or_raise(c: Context<ApiEnv>, project_id: string) {
  const project = await find_visible_project(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    project_id,
    user_id: c.get('user_id'),
  });
  if (!project) throw new NotFoundError('Project');
  return project;
}

export async function read_manageable_project_or_raise(c: Context<ApiEnv>, project_id: string) {
  const project = await read_project_or_raise(c, project_id);
  await assert_project_manager(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    project_id,
    user_id: c.get('user_id'),
  });
  return project;
}
