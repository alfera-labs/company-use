import type { SessionEnv } from '@agent-core/environment/session_env';
import { create_logger, format_error_message, map_with_concurrency } from '@coworker/shared';
import type { FileStorageProvider } from '@runtime-platform/files/file_storage_locations';
import {
  type ObjectStorage,
  open_file_object_storage,
} from '@runtime-platform/files/object_storage';
import { list_all_objects_by_prefix } from '@runtime-platform/storage/list_all_objects_by_prefix';
import { workspace_path_is_durable } from '@runtime-platform/storage/workspace_layouts';

const log = create_logger('chat_scratch_files');

export const chat_scratch_storage_provider = 'object_store' satisfies FileStorageProvider;

const restored_days = 7;
const restored_files_limit = 100;
const restored_bytes_limit = 20 * 1024 * 1024;
const restore_concurrency = 8;
const day_in_ms = 24 * 60 * 60 * 1000;

/** The chat a scratch file belongs to. Only a sandbox opened for this chat gets the file back. */
export type ChatScratchOwner = { workspace_id: string; session_id: string };

type ChatScratchFile = ChatScratchOwner & {
  workspace_path: string;
  data: Uint8Array;
  content_type: string;
};

type FileStorageLocationKey = { storage_provider: FileStorageProvider; storage_key: string };

type StoredScratchFile = { object_key: string; workspace_path: string; byte_size: number };

function day_prefix(owner: ChatScratchOwner, day: string) {
  return `workspace/${owner.workspace_id}/sessions/${owner.session_id}/scratch/${day}/`;
}

function format_day(time: Date) {
  return time.toISOString().slice(0, 10);
}

let reported_missing_storage = false;

function open_scratch_storage(purpose: 'save' | 'restore'): ObjectStorage | null {
  try {
    return open_file_object_storage(chat_scratch_storage_provider);
  } catch (error) {
    if (purpose === 'save' && !reported_missing_storage) {
      reported_missing_storage = true;
      log.warn('Object storage is not configured; chat scratch files last only in the sandbox.', {
        error: format_error_message(error),
      });
    }
    return null;
  }
}

function is_restorable_scratch_path(workspace_path: string) {
  return (
    workspace_path.length > 0 &&
    !workspace_path_is_durable(workspace_path) &&
    !workspace_path.split('/').includes('..')
  );
}

/**
 * Keeps a copy of a file the platform wrote to this chat's sandbox scratch (tmp/), outside the
 * shared volume, so a new sandbox for the same chat can get it back. A path on the volume needs
 * no copy. A file the platform rewrites, such as the activity log, replaces its earlier copy;
 * each chat's writes to one file run in order, so no two replacements race. Returns where the
 * copy is, or null when there is none. Never throws.
 */
export async function save_chat_scratch_file(
  file: ChatScratchFile,
  now = new Date(),
): Promise<FileStorageLocationKey | null> {
  if (!is_restorable_scratch_path(file.workspace_path)) return null;
  const storage = open_scratch_storage('save');
  if (!storage) return null;
  const object_key = `${day_prefix(file, format_day(now))}${file.workspace_path}`;
  try {
    await storage.delete(object_key);
    await storage.put_if_absent({ object_key, data: file.data, content_type: file.content_type });
    return { storage_provider: chat_scratch_storage_provider, storage_key: object_key };
  } catch (error) {
    log.warn('Could not keep a copy of a chat scratch file.', {
      workspace_id: file.workspace_id,
      session_id: file.session_id,
      workspace_path: file.workspace_path,
      error: format_error_message(error),
    });
    return null;
  }
}

/**
 * Where a file row reads its bytes from. A scratch file gets a copy kept for its chat, because
 * the sandbox that wrote it goes away. Any other file is read from its workspace path.
 */
export async function storage_for_workspace_file(
  file: ChatScratchFile,
): Promise<FileStorageLocationKey> {
  const kept_copy = await save_chat_scratch_file(file);
  return kept_copy ?? { storage_provider: 'local_workspace', storage_key: file.workspace_path };
}

async function list_recent_scratch_files(
  storage: ObjectStorage,
  owner: ChatScratchOwner,
  now: Date,
): Promise<StoredScratchFile[]> {
  const days = Array.from({ length: restored_days }, (_, index) =>
    format_day(new Date(now.getTime() - index * day_in_ms)),
  );
  const listed_by_day = await Promise.all(
    days.map(async (day) => {
      const prefix = day_prefix(owner, day);
      const objects = await list_all_objects_by_prefix(storage, prefix);
      return objects.map((object) => ({
        object_key: object.object_key,
        workspace_path: object.object_key.slice(prefix.length),
        byte_size: object.byte_size,
      }));
    }),
  );
  return listed_by_day.flat().filter((file) => is_restorable_scratch_path(file.workspace_path));
}

function newest_within_budget(files: readonly StoredScratchFile[]) {
  const chosen: StoredScratchFile[] = [];
  let chosen_bytes = 0;
  for (const file of files) {
    if (chosen.length >= restored_files_limit) break;
    if (chosen_bytes + file.byte_size > restored_bytes_limit) continue;
    chosen.push(file);
    chosen_bytes += file.byte_size;
  }
  return chosen;
}

async function sandbox_has_file(environment: SessionEnv, workspace_path: string) {
  if (environment.stat) return (await environment.stat(workspace_path)) !== null;
  return environment.read?.(workspace_path).then(
    () => true,
    () => false,
  );
}

/**
 * Puts this chat's recent scratch files back into a new sandbox: the last week of them, newest
 * day first, up to a size budget. A sandbox that already holds the first file in that order
 * wrote it or put it back itself, so it has them all: a warm sandbox costs one listing per day
 * and one check. Returns how many files it put back.
 */
export async function restore_chat_scratch_files(
  owner: ChatScratchOwner,
  environment: SessionEnv,
  now = new Date(),
): Promise<number> {
  const write = environment.write;
  const storage = open_scratch_storage('restore');
  if (!write || !storage) return 0;
  const chosen = newest_within_budget(await list_recent_scratch_files(storage, owner, now));
  const [newest] = chosen;
  if (!newest || (await sandbox_has_file(environment, newest.workspace_path))) return 0;
  await map_with_concurrency(chosen, restore_concurrency, async (file) => {
    const data = await storage.read(file.object_key);
    await write(file.workspace_path, new TextDecoder().decode(data));
  });
  return chosen.length;
}
