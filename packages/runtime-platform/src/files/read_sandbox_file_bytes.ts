import { create_local_session_env } from '@agent-core/environment';
import type { Database } from '@coworker/core';
import type { get_runtime_environment } from '@coworker/core/db/queries/sessions';
import { provider_error_status } from '@runtime-platform/files/provider_error_status';
import { read_volume_file_bytes } from '@runtime-platform/files/volume_file_reader';
import { read_e2b_workspace_bytes } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import { migrated_workspace_path } from '@runtime-platform/storage/workspace_layouts';

class FileNotFoundOnDisk extends Error {
  constructor(public readonly storage_key: string) {
    super(`Artifact bytes not found at ${storage_key}`);
  }
}

export async function read_sandbox_file_bytes(
  db: Database,
  input: {
    workspace_id: string;
    runtime_environment: Awaited<ReturnType<typeof get_runtime_environment>> & {};
    host_workspace_root: string;
    workspace_path: string;
  },
) {
  const migrated_path = migrated_workspace_path(input.workspace_path);
  try {
    return await read_workspace_bytes(db, input);
  } catch (error) {
    if (!migrated_path || !is_missing_file_error(error)) throw error;
    return read_workspace_bytes(db, { ...input, workspace_path: migrated_path });
  }
}

function is_missing_file_error(error: unknown) {
  if (error instanceof FileNotFoundOnDisk) return true;
  if (provider_error_status(error) === 404) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT';
}

async function read_workspace_bytes(
  db: Database,
  input: {
    workspace_id: string;
    runtime_environment: Awaited<ReturnType<typeof get_runtime_environment>> & {};
    host_workspace_root: string;
    workspace_path: string;
  },
) {
  const environment = input.runtime_environment;
  if (environment.environment_provider !== 'e2b') {
    return read_local_workspace_artifact_bytes(
      input.host_workspace_root,
      input.workspace_path,
      environment.environment_metadata.host_scratch_root,
    );
  }

  const volume_bytes = await read_volume_file_bytes(db, input);
  if (volume_bytes) return volume_bytes;

  return read_e2b_workspace_bytes({
    runtime_environment_metadata: environment.environment_metadata,
    provider_environment_id: environment.provider_environment_id,
    workspace_path: input.workspace_path,
  });
}

async function read_local_workspace_artifact_bytes(
  host_workspace_root: string,
  storage_key: string,
  host_scratch_root: unknown,
): Promise<Uint8Array> {
  const environment = create_local_session_env({
    workspace_root: host_workspace_root,
    working_directory: host_workspace_root,
    ...(typeof host_scratch_root === 'string' ? { scratch_root: host_scratch_root } : {}),
  });
  if (environment.read_bytes) return environment.read_bytes(storage_key);
  const text = await environment.read?.(storage_key);
  if (text === undefined) throw new FileNotFoundOnDisk(storage_key);
  return new TextEncoder().encode(text);
}

export function is_file_not_found_error(error: unknown): boolean {
  if (error instanceof FileNotFoundOnDisk) return true;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: string }).code === 'ENOENT'
  ) {
    return true;
  }
  return provider_error_status(error) === 404;
}

export function read_host_workspace_root(runtime_environment: {
  root_path: string;
  environment_metadata: unknown;
}) {
  const metadata = runtime_environment.environment_metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const host_workspace_root = (metadata as Record<string, unknown>).host_workspace_root;
    if (typeof host_workspace_root === 'string' && host_workspace_root.length > 0) {
      return host_workspace_root;
    }
  }

  return runtime_environment.root_path;
}
