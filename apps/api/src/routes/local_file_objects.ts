import type { ApiEnv } from '@api/lib/context';
import { error_body } from '@api/lib/response';
import {
  is_file_object_key_inside_workspace,
  type LocalFileTicketClaims,
  local_file_ticket_refused,
  open_local_disk_object_storage,
  StoredObjectSizeError,
  verify_local_file_ticket,
} from '@coworker/runtime-platform';
import { NotFoundError } from '@coworker/shared';
import { type Context, Hono } from 'hono';

/** Serves the links the local disk storage hands out, to the signed-in caller they were made for. */
export const local_file_object_routes = new Hono<ApiEnv>()
  .put('/v1/local_file_objects', store_uploaded_object)
  .get('/v1/local_file_objects', send_stored_object);

async function store_uploaded_object(c: Context<ApiEnv>) {
  const claims = verify_local_file_ticket(c.req.query('ticket') ?? '', 'put');
  const storage = open_storage_for_caller(c, claims);
  if (c.req.header('content-type') !== claims.content_type) {
    throw local_file_ticket_refused(`This link only accepts ${claims.content_type}.`);
  }
  try {
    const stored = await storage.write_stream({
      ...claims,
      stream: c.req.raw.body ?? empty_body(),
    });
    return c.body(null, 200, { ETag: stored.entity_tag });
  } catch (error) {
    if (!(error instanceof StoredObjectSizeError)) throw error;
    const status = error.received_bytes > error.expected_bytes ? 413 : 400;
    return c.json(error_body('file_size_mismatch', error.message), status);
  }
}

async function send_stored_object(c: Context<ApiEnv>) {
  const claims = verify_local_file_ticket(c.req.query('ticket') ?? '', 'get');
  const storage = open_storage_for_caller(c, claims);
  const stored = await storage.describe(claims.object_key);
  if (!stored) throw new NotFoundError('File');
  return c.body(await storage.open_stream(claims.object_key), 200, {
    'Content-Type': claims.content_type,
    'Content-Length': String(stored.byte_size),
    'Content-Disposition': attachment_content_disposition(claims.file_name),
    'Content-Security-Policy': 'sandbox',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
}

function open_storage_for_caller(c: Context<ApiEnv>, claims: LocalFileTicketClaims) {
  if (!is_file_object_key_inside_workspace(claims.object_key, c.get('workspace_id'))) {
    throw local_file_ticket_refused('This file link belongs to another workspace.');
  }
  const storage = open_local_disk_object_storage(claims.bucket_folder);
  if (!storage) throw new NotFoundError('File storage');
  return storage;
}

function empty_body() {
  return new Blob([]).stream();
}

function attachment_content_disposition(file_name: string) {
  const fallback = file_name.replace(/[^\x20-\x7e]|["\\]/gu, '_');
  const encoded = encodeURIComponent(file_name).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
