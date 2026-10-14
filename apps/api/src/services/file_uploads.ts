import type { Database } from '@coworker/core';
import { create_pending_upload_file, get_file } from '@coworker/core/db/queries/files';
import {
  default_file_storage_provider,
  find_file_storage_location,
  generate_file_object_key,
  is_file_object_key_inside_workspace,
  open_file_object_storage,
  runtime_attachment_limits,
} from '@coworker/runtime-platform';
import { create_id, id_prefixes, NotFoundError, ValidationError } from '@coworker/shared';
import { z } from 'zod';

// Mints one-shot permission for a browser to write exactly one object, then records the
// artifact row that will point at it.
//
// The browser never reaches the API with the bytes. Every dashboard request goes through a
// Vercel Function, which rejects a body over 4,500,000 bytes at the edge before any handler
// runs — so the API's own 25 MiB attachment limit was unreachable and a 9 MB file could not
// be sent at all. A presigned PUT goes browser -> R2 directly, and the ceiling becomes the
// product limit rather than the proxy's.

const upload_url_lifetime_seconds = 10 * 60;

export const create_file_upload_schema = z
  .object({
    file_name: z.string().min(1).max(400),
    mime_type: z.string().min(1).max(255),
    byte_size: z.number().int().positive().max(runtime_attachment_limits.max_attachment_bytes),
    session_id: z.string().min(1).max(120).optional(),
    project_id: z.string().min(1).max(120).optional(),
  })
  .strict();

export type CreateFileUploadInput = z.infer<typeof create_file_upload_schema>;

export async function create_file_upload(
  db: Database,
  input: CreateFileUploadInput & { workspace_id: string; user_id: string },
) {
  const file_id = create_id(id_prefixes.artifact);
  const object_key = generate_file_object_key({
    workspace_id: input.workspace_id,
    file_id,
    file_name: input.file_name,
  });

  const storage = open_file_object_storage(default_file_storage_provider);
  const upload_url = await storage.create_presigned_put_url({
    object_key,
    content_type: input.mime_type,
    byte_size: input.byte_size,
    expires_in_seconds: upload_url_lifetime_seconds,
  });

  const artifact = await create_pending_upload_file(db, {
    file_id,
    workspace_id: input.workspace_id,
    ...(input.session_id ? { session_id: input.session_id } : {}),
    ...(input.project_id ? { project_id: input.project_id } : {}),
    file_purpose: 'user_upload',
    storage_provider: default_file_storage_provider,
    storage_key: object_key,
    file_name: input.file_name,
    mime_type: input.mime_type,
    byte_size: input.byte_size,
    actor_id: input.user_id,
  });

  return {
    file_id: artifact.file_id,
    file_name: artifact.file_name,
    mime_type: artifact.mime_type,
    byte_size: artifact.byte_size,
    upload_url,
    upload_method: 'PUT' as const,
    // The browser must send exactly these, because they are covered by the signature.
    upload_headers: { 'Content-Type': input.mime_type },
    upload_expires_in_seconds: upload_url_lifetime_seconds,
  };
}

const download_url_lifetime_seconds = 5 * 60;

export async function create_file_download(
  db: Database,
  input: { workspace_id: string; file_id: string },
) {
  const file = await get_file(db, input.workspace_id, input.file_id);
  if (!file) throw new NotFoundError('File');
  if (file.file_status === 'pending') {
    throw new ValidationError(`${file.file_name ?? 'This file'} has not finished uploading`);
  }

  const { storage_provider, location } = find_file_storage_location(file.storage_provider);
  if (location.reads_bytes_from !== 'object_bucket') {
    throw new ValidationError(
      `${file.file_name ?? 'This file'} is not stored where it can be downloaded`,
    );
  }
  if (!is_file_object_key_inside_workspace(file.storage_key, file.workspace_id)) {
    throw new ValidationError('File storage key does not belong to this workspace');
  }

  const file_name = file.file_name ?? file.file_id;
  const mime_type = file.mime_type ?? 'application/octet-stream';
  return {
    file_id: file.file_id,
    file_name,
    mime_type,
    byte_size: file.byte_size,
    download_url: await open_file_object_storage(storage_provider).create_presigned_get_url({
      object_key: file.storage_key,
      file_name,
      mime_type,
      expires_in_seconds: download_url_lifetime_seconds,
    }),
    download_expires_in_seconds: download_url_lifetime_seconds,
  };
}
