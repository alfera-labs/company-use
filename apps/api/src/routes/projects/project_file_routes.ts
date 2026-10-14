import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import {
  read_manageable_project_or_raise,
  read_project_or_raise,
} from '@api/routes/projects/project_reader';
import { read_file_or_raise } from '@api/routes/sessions/session_reader';
import {
  attach_project_file,
  detach_project_file,
  list_project_files,
} from '@coworker/core/db/queries/project_files';
import { create_stored_file_attachment_sources } from '@coworker/runtime-platform';
import { NotFoundError } from '@coworker/shared';
import { Hono } from 'hono';

export const project_file_routes = new Hono<ApiEnv>()
  .get('/v1/projects/:project_id/files', async (c) => {
    const project = await read_project_or_raise(c, c.req.param('project_id'));
    const files = await list_project_files(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
    });
    return c.json(ok(files));
  })
  .put('/v1/projects/:project_id/files/:file_id', async (c) => {
    const project = await read_manageable_project_or_raise(c, c.req.param('project_id'));
    const file = await read_file_or_raise(c, c.req.param('file_id'));
    if (file.project_id && file.project_id !== project.project_id) {
      throw new NotFoundError('File');
    }
    await create_stored_file_attachment_sources(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      file_ids: [file.file_id],
      actor_id: c.get('user_id'),
    });
    const attached = await attach_project_file(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
      file_id: file.file_id,
      actor_id: c.get('user_id'),
    });
    return c.json(ok(attached));
  })
  .delete('/v1/projects/:project_id/files/:file_id', async (c) => {
    const project = await read_manageable_project_or_raise(c, c.req.param('project_id'));
    await detach_project_file(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
      file_id: c.req.param('file_id'),
      actor_id: c.get('user_id'),
    });
    return c.body(null, 204);
  });
