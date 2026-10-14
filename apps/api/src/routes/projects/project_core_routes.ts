import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import {
  read_manageable_project_or_raise,
  read_project_or_raise,
} from '@api/routes/projects/project_reader';
import {
  create_project_schema,
  list_projects_schema,
  update_project_schema,
} from '@api/routes/projects/project_schemas';
import { project_is_manageable_by_user } from '@coworker/core/access/assert_project_manager';
import { update_project } from '@coworker/core/db/queries/project_updates';
import { create_project, list_projects } from '@coworker/core/db/queries/projects';
import { Hono } from 'hono';

export const project_core_routes = new Hono<ApiEnv>()
  .post('/v1/projects', validate_json(create_project_schema), async (c) => {
    const user_id = c.get('user_id');
    const project = await create_project(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_name: c.req.valid('json').project_name,
      actor_id: user_id,
      owner_id: user_id,
    });
    return c.json(ok(project), 201);
  })
  .get('/v1/projects', validate_query(list_projects_schema), async (c) => {
    const query = c.req.valid('query');
    const projects = await list_projects(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_status: query.project_status,
      limit: query.limit,
      visible_to_user_id: c.get('user_id'),
      ...(query.query === undefined ? {} : { query: query.query }),
    });
    return c.json(ok(projects));
  })
  .get('/v1/projects/:project_id', async (c) => {
    const project = await read_project_or_raise(c, c.req.param('project_id'));
    const can_manage = await project_is_manageable_by_user(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
      user_id: c.get('user_id'),
    });
    return c.json(ok({ ...project, can_manage }));
  })
  .patch('/v1/projects/:project_id', validate_json(update_project_schema), async (c) => {
    const project_id = c.req.param('project_id');
    await read_manageable_project_or_raise(c, project_id);
    const body = c.req.valid('json');
    const project = await update_project(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id,
      actor_id: c.get('user_id'),
      ...(body.project_name === undefined ? {} : { project_name: body.project_name }),
      ...(body.project_status === undefined ? {} : { project_status: body.project_status }),
      ...(body.project_description === undefined
        ? {}
        : { project_description: body.project_description }),
      ...(body.project_instructions === undefined
        ? {}
        : { project_instructions: body.project_instructions }),
    });
    return c.json(ok(project));
  });
