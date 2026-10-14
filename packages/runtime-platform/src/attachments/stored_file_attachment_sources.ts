import type { Database } from '@coworker/core';
import { list_files_by_ids, mark_file_stored } from '@coworker/core/db/queries/files';
import { ValidationError } from '@coworker/shared';
import {
  create_runtime_attachment_source_map,
  type RuntimeAttachmentSource,
} from '@runtime-platform/attachments/runtime_attachment_source';
import { is_file_object_key_inside_workspace } from '@runtime-platform/files/file_object_key';
import { find_file_storage_location } from '@runtime-platform/files/file_storage_locations';
import { open_file_object_storage } from '@runtime-platform/files/object_storage';

export async function create_stored_file_attachment_sources(
  db: Database,
  input: { workspace_id: string; file_ids: readonly string[]; actor_id: string },
): Promise<RuntimeAttachmentSource[]> {
  if (input.file_ids.length === 0) return [];

  const files = await list_files_by_ids(db, input.workspace_id, input.file_ids);
  const missing_ids = input.file_ids.filter(
    (file_id) => !files.some((file) => file.file_id === file_id),
  );
  if (missing_ids.length > 0) {
    throw new ValidationError(`Unknown attachment ids: ${missing_ids.join(', ')}`);
  }

  const sources = await Promise.all(
    files.map((file) => confirm_stored_file(db, file, input.actor_id)),
  );
  create_runtime_attachment_source_map(sources);
  return sources;
}

async function confirm_stored_file(
  db: Database,
  file: Awaited<ReturnType<typeof list_files_by_ids>>[number],
  actor_id: string,
): Promise<RuntimeAttachmentSource> {
  const { storage_provider, location } = find_file_storage_location(file.storage_provider);
  if (location.reads_bytes_from !== 'object_bucket') {
    throw new ValidationError(
      `Attachment ${file.file_id} is not stored where the runtime can read it`,
    );
  }

  if (!is_file_object_key_inside_workspace(file.storage_key, file.workspace_id)) {
    throw new ValidationError(`Attachment ${file.file_id} has a storage key outside its workspace`);
  }
  const storage = open_file_object_storage(storage_provider);
  const stored = await storage.describe(file.storage_key);
  if (!stored) {
    throw new ValidationError(`Attachment ${file.file_name ?? file.file_id} was never uploaded`);
  }
  if (file.file_status === 'pending') {
    await mark_file_stored(db, {
      workspace_id: file.workspace_id,
      file_id: file.file_id,
      byte_size: stored.byte_size,
      actor_id,
    });
  }

  return {
    attachment_id: file.file_id,
    stored_file_id: file.file_id,
    file_name: file.file_name ?? file.file_id,
    mime_type: file.mime_type ?? stored.content_type ?? 'application/octet-stream',
    byte_size: stored.byte_size,
    open_bytes: () => storage.open_stream(file.storage_key),
  };
}
