import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  read_manageable_project_or_raise,
  read_project_or_raise,
} from '@api/routes/projects/project_reader';
import {
  project_member_grantee_schema,
  project_member_schema,
} from '@api/routes/projects/project_schemas';
import { add_project_member } from '@api/services/project_membership';
import {
  list_project_members,
  remove_project_member,
} from '@coworker/core/db/queries/project_members';
import { ValidationError } from '@coworker/shared';
import { Hono } from 'hono';

export const project_member_routes = new Hono<ApiEnv>()
  .get('/v1/projects/:project_id/members', async (c) => {
    const project = await read_project_or_raise(c, c.req.param('project_id'));
    const members = await list_project_members(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
    });
    return c.json(ok({ membership_version: project.membership_version, members }));
  })
  .put('/v1/projects/:project_id/members', validate_json(project_member_schema), async (c) => {
    const project = await read_manageable_project_or_raise(c, c.req.param('project_id'));
    const member = await add_project_member(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
      ...c.req.valid('json'),
      actor_id: c.get('user_id'),
    });
    return c.json(ok(member));
  })
  .delete('/v1/projects/:project_id/members/:grantee_type/:grantee_id', async (c) => {
    const project = await read_manageable_project_or_raise(c, c.req.param('project_id'));
    const parsed = project_member_grantee_schema.safeParse(c.req.param('grantee_type'));
    if (!parsed.success) throw new ValidationError('grantee_type must be user or agent.');
    await remove_project_member(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
      grantee_type: parsed.data,
      grantee_id: c.req.param('grantee_id'),
      actor_id: c.get('user_id'),
    });
    return c.body(null, 204);
  });
