import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { parse_query } from '@api/lib/validate';
import { list_projects_schema } from '@api/routes/projects/project_schemas';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { list_projects, type ProjectRow } from '@coworker/core/db/queries/projects';
import { type Context, Hono } from 'hono';

type PublicProject = {
  project_id: string;
  name: string;
  description: string | null;
  status: string;
  created_time: Date;
};

export const public_project_routes = new Hono<ApiEnv>().get(
  '/v1/projects',
  key_authed_route('projects.read', list_public_projects),
);

async function list_public_projects(c: Context<ApiEnv>, api_key: ApiKey) {
  const query = parse_query(c, list_projects_schema);
  const projects = await list_projects(c.get('db'), {
    workspace_id: api_key.workspace_id,
    project_status: query.project_status,
    limit: query.limit,
    visible_to_user_id: api_key.api_key_id,
    ...(query.query === undefined ? {} : { query: query.query }),
  });
  return c.json(ok(projects.map(public_project)));
}

function public_project(project: ProjectRow): PublicProject {
  return {
    project_id: project.project_id,
    name: project.project_name,
    description: project.project_description,
    status: project.project_status,
    created_time: project.created_time,
  };
}
