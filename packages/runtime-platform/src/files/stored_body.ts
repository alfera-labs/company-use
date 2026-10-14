import { createHash } from 'node:crypto';
import type { Database } from '@coworker/core';
import { create_file, list_files_by_ids } from '@coworker/core/db/queries/files';
import { create_logger } from '@coworker/shared';
import { is_file_object_key_inside_workspace } from '@runtime-platform/files/file_object_key';
import {
  type ObjectStorage,
  open_file_object_storage,
} from '@runtime-platform/files/object_storage';
import {
  cache_stored_text,
  read_cached_stored_text,
} from '@runtime-platform/files/stored_value_cache';

export const large_value_threshold_bytes = 32_768;
const artifact_ref_preview_chars = 500;
const log = create_logger('stored_body');

export type ArtifactRef = { artifact_id: string; byte_size: number; preview: string };

export type StoreLargeValueInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  source_tool_call_id: string | null;
  file_purpose: string;
  value: unknown;
  actor_id: string;
};

export function is_large_value(value: unknown) {
  const serialized = JSON.stringify(value);
  return serialized !== undefined && Buffer.byteLength(serialized) > large_value_threshold_bytes;
}

export function read_artifact_ref(value: unknown): ArtifactRef | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const ref = (value as { artifact_ref?: unknown }).artifact_ref;
  if (typeof ref !== 'object' || ref === null) return undefined;
  const { artifact_id, byte_size, preview } = ref as Record<string, unknown>;
  if (typeof artifact_id !== 'string' || typeof byte_size !== 'number') return undefined;
  return { artifact_id, byte_size, preview: typeof preview === 'string' ? preview : '' };
}

export async function store_large_value(
  db: Database,
  input: StoreLargeValueInput,
): Promise<ArtifactRef | null> {
  const storage = open_storage_for_large_values();
  if (!storage) return null;

  const serialized = JSON.stringify(input.value);
  const data = Buffer.from(serialized, 'utf8');
  const checksum_sha256 = createHash('sha256').update(data).digest('hex');
  const object_key = `ws/${input.workspace_id}/sha256/${checksum_sha256}`;
  try {
    await storage.put_if_absent({ object_key, data, content_type: 'application/json' });
  } catch (error) {
    log.error('Object storage refused a large value; it stays inline.', {
      workspace_id: input.workspace_id,
      file_purpose: input.file_purpose,
      source_tool_call_id: input.source_tool_call_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const preview = serialized.slice(0, artifact_ref_preview_chars);
  const artifact = await create_file(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    source_tool_call_id: input.source_tool_call_id,
    file_purpose: input.file_purpose,
    storage_provider: 'object_store',
    storage_key: object_key,
    mime_type: 'application/json',
    byte_size: data.byteLength,
    checksum_sha256,
    content_preview: preview,
    is_visible: false,
    file_metadata: { body_format: 'json' },
    actor_id: input.actor_id,
  });
  return { artifact_id: artifact.file_id, byte_size: data.byteLength, preview };
}

export async function load_stored_value(
  db: Database,
  input: { workspace_id: string; artifact_id: string },
) {
  const values = await load_stored_values(db, {
    workspace_id: input.workspace_id,
    artifact_ids: [input.artifact_id],
  });
  if (!values.has(input.artifact_id))
    throw new Error(`Stored value ${input.artifact_id} is missing`);
  return values.get(input.artifact_id);
}

export async function load_stored_values(
  db: Database,
  input: { workspace_id: string; artifact_ids: readonly string[] },
): Promise<Map<string, unknown>> {
  const unique_ids = [...new Set(input.artifact_ids)];
  const artifacts = await list_files_by_ids(db, input.workspace_id, unique_ids);
  if (artifacts.length === 0) return new Map();

  const storage = open_file_object_storage('object_store');
  const loaded = await Promise.all(
    artifacts.map(async (artifact) => {
      if (!is_file_object_key_inside_workspace(artifact.storage_key, input.workspace_id)) {
        throw new Error(`Stored value ${artifact.file_id} has a key outside its workspace`);
      }
      const text = await read_stored_text(storage, artifact.storage_key);
      return [artifact.file_id, JSON.parse(text)] as const;
    }),
  );
  return new Map(loaded);
}

async function read_stored_text(storage: ObjectStorage, object_key: string) {
  const cached = read_cached_stored_text(object_key);
  if (cached !== undefined) return cached;
  const bytes = await storage.read(object_key);
  const text = Buffer.from(bytes).toString('utf8');
  cache_stored_text(object_key, text, bytes.byteLength);
  return text;
}

let reported_missing_storage = false;

function open_storage_for_large_values(): ObjectStorage | null {
  try {
    return open_file_object_storage('object_store');
  } catch (error) {
    if (!reported_missing_storage) {
      reported_missing_storage = true;
      log.warn('Object storage is not configured; large values stay inline.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}
