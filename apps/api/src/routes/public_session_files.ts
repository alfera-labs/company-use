import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_route_param } from '@api/lib/route_params';
import {
  list_api_session_files,
  open_api_session_file,
} from '@api/services/sessions_api/session_files';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { type Context, Hono } from 'hono';

export const public_session_file_routes = new Hono<ApiEnv>()
  .get('/v1/sessions/:session_id/files', key_authed_route('sessions.read', list_session_files))
  .get('/v1/files/:file_id/content', key_authed_route('sessions.read', read_file_content));

async function list_session_files(c: Context<ApiEnv>, api_key: ApiKey) {
  const files = await list_api_session_files(
    c.get('db'),
    api_key,
    require_route_param(c, 'session_id'),
  );
  return c.json(ok(files));
}

async function read_file_content(c: Context<ApiEnv>, api_key: ApiKey) {
  const opened = await open_api_session_file(
    c.get('db'),
    api_key,
    require_route_param(c, 'file_id'),
  );
  return c.body(bytes_as_body(opened.content_bytes), 200, {
    'Content-Type': opened.mime_type,
    'Content-Length': String(opened.content_bytes.byteLength),
    ...(opened.file.filename
      ? { 'Content-Disposition': content_disposition(opened.file.filename) }
      : {}),
  });
}

// A copy the response owns, because the source may be a view onto a larger buffer and Hono hands
// whatever it is straight to the platform.
function bytes_as_body(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function content_disposition(filename: string) {
  return `attachment; filename="${filename.replace(/["\\]/g, '_')}"`;
}
