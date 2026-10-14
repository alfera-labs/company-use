import type { Database } from '@coworker/core';
import { list_running_e2b_environments_for_volume } from '@coworker/core/db/queries/runtime_environments';
import { volume_root_path } from '@coworker/core/db/queries/volumes';
import {
  replace_e2b_workspace_bytes,
  replace_workspace_volume_file,
  validate_workspace_file_path,
  type WorkspaceVolumeAddress,
} from '@coworker/runtime-platform';
import { AppError } from '@coworker/shared';

export async function replace_workspace_file(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    address: WorkspaceVolumeAddress;
    file_path: string;
    data: Uint8Array;
    expected_version: string;
    content_version: string;
  },
) {
  const file_path = validate_workspace_file_path(input.address, input.file_path);
  if ('host_workspace_root' in input.address) {
    return replace_workspace_volume_file(input.address, { ...input, file_path });
  }
  const environments = await list_running_e2b_environments_for_volume(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    volume_id: input.address.volume_id,
    volume_workspace_path: input.address.volume_workspace_path,
  });
  const errors: unknown[] = [];
  for (const environment of environments) {
    if (!environment.provider_environment_id) continue;
    try {
      const replaced = await replace_e2b_workspace_bytes({
        provider_sandbox_id: environment.provider_environment_id,
        volume_root_path: read_metadata_string(
          environment.environment_metadata,
          'volume_root_path',
        ),
        volume_workspace_path: input.address.volume_workspace_path,
        file_path,
        data: input.data,
        expected_version: input.expected_version,
        content_version: input.content_version,
      });
      if (replaced) return;
    } catch (error) {
      if (error instanceof AppError && [400, 403, 409].includes(error.status)) throw error;
      errors.push(error);
    }
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'No active workspace owner accepted the file write.');
  await replace_workspace_volume_file(input.address, { ...input, file_path });
}

function read_metadata_string(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('The runtime environment has no volume metadata.');
  }
  const value = (metadata as Record<string, unknown>)[key];
  if (value !== volume_root_path) {
    throw new Error('The runtime environment has an invalid volume root path.');
  }
  return value;
}
