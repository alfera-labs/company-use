import type { Database } from '@coworker/core';
import type { get_runtime_environment } from '@coworker/core/db/queries/sessions';
import { get_volume } from '@coworker/core/db/queries/volumes';
import { AppError } from '@coworker/shared';
import { provider_error_status } from '@runtime-platform/files/provider_error_status';
import { read_e2b_workspace_bytes } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import {
  read_volume_id,
  read_volume_workspace_path,
} from '@runtime-platform/storage/volume_metadata';
import {
  read_archil_volume_bytes,
  workspace_object_key,
} from '@runtime-platform/storage/volume_objects';

type RuntimeEnvironment = NonNullable<Awaited<ReturnType<typeof get_runtime_environment>>>;

export async function read_volume_file_bytes(
  db: Database,
  input: {
    workspace_id: string;
    runtime_environment: RuntimeEnvironment;
    workspace_path: string;
  },
  read_archil_bytes: typeof read_archil_volume_bytes = read_archil_volume_bytes,
) {
  const environment = input.runtime_environment;
  const volume_id = read_volume_id(environment.environment_metadata);
  if (!volume_id) return undefined;
  const volume = await get_volume(db, {
    workspace_id: input.workspace_id,
    volume_id,
  });
  if (volume?.volume_provider !== 'archil' || !volume.provider_volume_id) {
    return undefined;
  }

  const live_bytes = await read_live_sandbox_bytes(environment, input.workspace_path);
  if (live_bytes) return live_bytes;
  const volume_relative_path = workspace_object_key(
    read_volume_workspace_path(environment.environment_metadata),
    input.workspace_path,
  );
  try {
    return await read_archil_bytes({
      provider_volume_id: volume.provider_volume_id,
      volume_relative_path,
      ...(volume.provider_region ? { region: volume.provider_region } : {}),
    });
  } catch (error) {
    if (provider_error_status(error) === 404) throw error;
    throw new AppError(
      'artifact_storage_temporarily_unavailable',
      'Artifact bytes are not currently readable from the sandbox or durable workspace.',
      503,
    );
  }
}

async function read_live_sandbox_bytes(environment: RuntimeEnvironment, workspace_path: string) {
  if (environment.environment_status !== 'running') return undefined;
  try {
    return await read_e2b_workspace_bytes({
      runtime_environment_metadata: environment.environment_metadata,
      provider_environment_id: environment.provider_environment_id,
      workspace_path,
    });
  } catch {
    return undefined;
  }
}
