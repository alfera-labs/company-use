import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { parse_json_body } from '@api/lib/validate';
import { local_file_object_routes } from '@api/routes/local_file_objects';
import { read_manageable_project_or_raise } from '@api/routes/projects/project_reader';
import { read_file_or_raise, read_session_or_raise } from '@api/routes/sessions/session_reader';
import {
  create_file_download,
  create_file_upload,
  create_file_upload_schema,
} from '@api/services/file_uploads';
import { type Context, Hono } from 'hono';

export function create_file_upload_routes() {
  return new Hono<ApiEnv>()
    .post('/v1/files/uploads', request_file_upload)
    .get('/v1/files/:file_id/download', request_file_download)
    .route('/', local_file_object_routes);
}

async function request_file_upload(c: Context<ApiEnv>) {
  const body = await parse_json_body(c, create_file_upload_schema);
  if (body.session_id) await read_session_or_raise(c, body.session_id);
  if (body.project_id) await read_manageable_project_or_raise(c, body.project_id);

  const upload = await create_file_upload(c.get('db'), {
    ...body,
    workspace_id: c.get('workspace_id'),
    user_id: c.get('user_id'),
  });
  return c.json(ok(upload), 201);
}

async function request_file_download(c: Context<ApiEnv, '/v1/files/:file_id/download'>) {
  await read_file_or_raise(c, c.req.param('file_id'));
  const download = await create_file_download(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    file_id: c.req.param('file_id'),
  });
  return c.json(ok(download));
}
