import type { Database } from '@coworker/core';
import { get_file, mark_file_missing } from '@coworker/core/db/queries/files';
import { NotFoundError, ValidationError } from '@coworker/shared';
import { is_file_object_key_inside_workspace } from '@runtime-platform/files/file_object_key';
import { find_file_storage_location } from '@runtime-platform/files/file_storage_locations';
import { open_file_object_storage } from '@runtime-platform/files/object_storage';

export type OpenedFileBytes = {
  file: NonNullable<Awaited<ReturnType<typeof get_file>>>;
  byte_size: number;
  mime_type: string;
  open_stream: () => Promise<ReadableStream<Uint8Array>>;
};

export async function open_file_bytes(
  db: Database,
  input: { workspace_id: string; file_id: string; actor_id: string },
): Promise<OpenedFileBytes> {
  const file = await get_file(db, input.workspace_id, input.file_id);
  if (!file) throw new NotFoundError('File');
  if (file.file_status === 'pending') {
    throw new ValidationError(`File ${file.file_id} has not finished uploading`);
  }

  const { storage_provider, location } = find_file_storage_location(file.storage_provider);
  if (location.reads_bytes_from !== 'object_bucket') {
    throw new ValidationError(
      `File ${file.file_id} is stored in ${file.storage_provider}, which this reader cannot open. Open it through the runtime environment instead.`,
    );
  }

  if (!is_file_object_key_inside_workspace(file.storage_key, file.workspace_id)) {
    throw new ValidationError(`File ${file.file_id} has a storage key outside its workspace`);
  }
  const storage = open_file_object_storage(storage_provider);
  const stored = await storage.describe(file.storage_key);
  if (!stored) {
    await mark_file_missing(db, {
      workspace_id: input.workspace_id,
      file_id: file.file_id,
      actor_id: input.actor_id,
    });
    throw new NotFoundError('File bytes');
  }

  return {
    file,
    byte_size: stored.byte_size,
    mime_type: file.mime_type ?? stored.content_type ?? 'application/octet-stream',
    open_stream: () => storage.open_stream(file.storage_key),
  };
}
