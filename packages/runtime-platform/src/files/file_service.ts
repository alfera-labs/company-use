import { createHash } from 'node:crypto';
import type { Database } from '@coworker/core';
import { get_file, mark_file_missing } from '@coworker/core/db/queries/files';
import { get_runtime_environment } from '@coworker/core/db/queries/sessions';
import { NotFoundError } from '@coworker/shared';
import { is_file_object_key_inside_workspace } from '@runtime-platform/files/file_object_key';
import {
  type FileStorageProvider,
  find_file_storage_location,
} from '@runtime-platform/files/file_storage_locations';
import { open_file_object_storage } from '@runtime-platform/files/object_storage';
import {
  is_file_not_found_error,
  read_host_workspace_root,
  read_sandbox_file_bytes,
} from '@runtime-platform/files/read_sandbox_file_bytes';

export type OpenRuntimeFileResult =
  | {
      missing: false;
      file: Awaited<ReturnType<typeof get_file>>;
      content_bytes: Uint8Array;
      content_text: string | null;
      mime_type: string;
      byte_size: number;
      checksum_sha256: string;
    }
  | {
      missing: true;
      file: Awaited<ReturnType<typeof mark_file_missing>>;
      content_bytes: null;
      content_text: null;
    };

export async function open_runtime_file(
  db: Database,
  input: { workspace_id: string; file_id: string; actor_id: string },
): Promise<OpenRuntimeFileResult> {
  const file = await get_file(db, input.workspace_id, input.file_id);
  if (!file) throw new NotFoundError('File');

  const { storage_provider, location } = find_file_storage_location(file.storage_provider);
  if (location.reads_bytes_from === 'object_bucket') {
    return open_stored_file_result(db, file, storage_provider, input.actor_id);
  }
  if (location.reads_bytes_from !== 'sandbox_or_volume_path') {
    throw new Error(
      `File ${file.file_id} is stored in ${file.storage_provider} and has no reader here`,
    );
  }
  if (!file.runtime_environment_id) {
    throw new Error(`File ${file.file_id} has no runtime environment`);
  }

  const runtime_environment = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id: file.runtime_environment_id,
  });
  if (!runtime_environment) throw new NotFoundError('Runtime environment');

  const host_workspace_root = read_host_workspace_root(runtime_environment);
  let bytes: Uint8Array | undefined;
  try {
    bytes = await read_sandbox_file_bytes(db, {
      workspace_id: input.workspace_id,
      runtime_environment,
      host_workspace_root,
      workspace_path: file.storage_key,
    });
  } catch (error) {
    if (is_file_not_found_error(error)) {
      return missing_file_result(db, input.workspace_id, file.file_id, input.actor_id);
    }
    throw error;
  }

  if (bytes === undefined) {
    return missing_file_result(db, input.workspace_id, file.file_id, input.actor_id);
  }

  return opened_file_result(file, bytes);
}

async function open_stored_file_result(
  db: Database,
  file: NonNullable<Awaited<ReturnType<typeof get_file>>>,
  storage_provider: FileStorageProvider,
  actor_id: string,
): Promise<OpenRuntimeFileResult> {
  if (!is_file_object_key_inside_workspace(file.storage_key, file.workspace_id)) {
    throw new Error(`File ${file.file_id} has a storage key outside its workspace`);
  }
  const storage = open_file_object_storage(storage_provider);
  const stored = await storage.describe(file.storage_key);
  if (!stored) return missing_file_result(db, file.workspace_id, file.file_id, actor_id);
  return opened_file_result(file, await storage.read(file.storage_key));
}

async function missing_file_result(
  db: Database,
  workspace_id: string,
  file_id: string,
  actor_id: string,
) {
  const file = await mark_file_missing(db, { workspace_id, file_id, actor_id });
  return { missing: true as const, file, content_bytes: null, content_text: null };
}

function opened_file_result(
  file: NonNullable<Awaited<ReturnType<typeof get_file>>>,
  bytes: Uint8Array,
): OpenRuntimeFileResult {
  const mime_type = file.mime_type ?? 'application/octet-stream';
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const checksum_sha256 = createHash('sha256').update(buffer).digest('hex');
  if (file.checksum_sha256 && file.checksum_sha256 !== checksum_sha256) {
    throw new Error(`Artifact checksum mismatch for ${file.file_id}`);
  }
  const content_text = decode_text_if_text(bytes, mime_type);
  return {
    missing: false,
    file,
    content_bytes: bytes,
    content_text,
    mime_type,
    byte_size: bytes.byteLength,
    checksum_sha256,
  };
}

function decode_text_if_text(bytes: Uint8Array, mime_type: string): string | null {
  if (!mime_type.startsWith('text/') && mime_type !== 'application/json') return null;
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}
