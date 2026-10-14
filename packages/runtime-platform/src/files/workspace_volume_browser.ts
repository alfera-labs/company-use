import path from 'node:path';
import type { Database } from '@coworker/core/db/connection';
import { find_volume } from '@coworker/core/db/queries/volumes';
import { AppError, format_error_message } from '@coworker/shared';
import { provider_error_status } from '@runtime-platform/files/provider_error_status';
import { replace_archil_volume_bytes } from '@runtime-platform/storage/atomic_volume_replace';
import {
  find_host_workspace_address,
  type HostWorkspaceAddress,
  is_no_file_error,
} from '@runtime-platform/storage/host_volume';
import {
  list_host_workspace_entries,
  read_host_workspace_bytes,
  replace_host_workspace_bytes,
  write_host_workspace_bytes,
} from '@runtime-platform/storage/host_volume_objects';
import {
  list_archil_volume_entries,
  read_archil_volume_bytes,
  workspace_object_key,
  write_archil_volume_bytes,
} from '@runtime-platform/storage/volume_objects';
import {
  model_may_write_workspace_path,
  volume_workspace_path,
  type WorkspaceLayout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';

export type CloudVolumeAddress = {
  volume_id: string;
  provider_volume_id: string;
  region: string | undefined;
  volume_workspace_path: string;
  layout: WorkspaceLayout;
};

export type WorkspaceVolumeAddress = CloudVolumeAddress | HostWorkspaceAddress;

export async function resolve_workspace_volume_address(
  db: Database,
  input: Parameters<typeof find_host_workspace_address>[0],
): Promise<WorkspaceVolumeAddress | null> {
  const volume = await find_volume(db, input.workspace_id);
  if (!volume) return find_host_workspace_address(input);
  if (
    volume.volume_provider !== 'archil' ||
    !volume.provider_volume_id ||
    volume.volume_status !== 'active'
  ) {
    return null;
  }
  const layout = workspace_layout_for_version(volume.volume_config.workspace_layout_version);
  return {
    volume_id: volume.volume_id,
    provider_volume_id: volume.provider_volume_id,
    region: volume.provider_region ?? undefined,
    volume_workspace_path: volume_workspace_path(input.agent_id, layout),
    layout,
  };
}

/** The user-facing description of a workspace root folder, off the layout record. */
export function workspace_folder_description(layout: WorkspaceLayout, folder_path: string) {
  return layout.folders.find((folder) => folder.path === folder_path)?.holds ?? null;
}

/**
 * Whether the panel lets a person write this path. The layout already records which folders
 * the platform owns (`system/` and friends); a person editing those would fight the platform
 * the same way the model would, so the one gate serves both.
 */
export function user_may_write_workspace_path(layout: WorkspaceLayout, workspace_path: string) {
  return model_may_write_workspace_path(workspace_path, layout);
}

export function validate_workspace_file_path(
  address: WorkspaceVolumeAddress,
  workspace_path: string,
) {
  const normalized_path = path.posix.normalize(workspace_path);
  if (!user_may_write_workspace_path(address.layout, normalized_path)) {
    throw new AppError(
      'workspace_path_not_writable',
      'This folder is maintained by Alfera and cannot be edited.',
      403,
    );
  }
  if (!('host_workspace_root' in address)) workspace_relative_key(address, workspace_path);
  return normalized_path;
}

export async function list_workspace_volume_folder(
  address: WorkspaceVolumeAddress,
  folder_path: string,
  list_volume_entries: typeof list_archil_volume_entries = list_archil_volume_entries,
) {
  return with_readable_path_errors(() =>
    'host_workspace_root' in address
      ? list_host_workspace_entries({ ...address, workspace_path: folder_path })
      : list_volume_entries({
          provider_volume_id: address.provider_volume_id,
          volume_relative_path: workspace_relative_key(address, folder_path),
          ...(address.region ? { region: address.region } : {}),
        }),
  );
}

export async function read_workspace_volume_file(
  address: WorkspaceVolumeAddress,
  file_path: string,
  read_volume_bytes: typeof read_archil_volume_bytes = read_archil_volume_bytes,
) {
  return with_readable_path_errors(() =>
    'host_workspace_root' in address
      ? read_host_workspace_bytes({ ...address, workspace_path: file_path })
      : read_volume_bytes({
          provider_volume_id: address.provider_volume_id,
          volume_relative_path: workspace_relative_key(address, file_path),
          ...(address.region ? { region: address.region } : {}),
        }),
  );
}

export async function write_workspace_volume_file(
  address: WorkspaceVolumeAddress,
  input: { file_path: string; data: Uint8Array },
  write_volume_bytes: typeof write_archil_volume_bytes = write_archil_volume_bytes,
) {
  validate_workspace_file_path(address, input.file_path);
  return with_readable_path_errors(() =>
    'host_workspace_root' in address
      ? write_host_workspace_bytes({ ...address, workspace_path: input.file_path, ...input })
      : write_volume_bytes({
          provider_volume_id: address.provider_volume_id,
          volume_relative_path: workspace_relative_key(address, input.file_path),
          data: input.data,
          ...(address.region ? { region: address.region } : {}),
        }),
  );
}

export async function replace_workspace_volume_file(
  address: WorkspaceVolumeAddress,
  input: {
    file_path: string;
    data: Uint8Array;
    expected_version: string;
    content_version: string;
  },
  replace_volume_bytes: typeof replace_archil_volume_bytes = replace_archil_volume_bytes,
) {
  validate_workspace_file_path(address, input.file_path);
  return with_readable_path_errors(() =>
    'host_workspace_root' in address
      ? replace_host_workspace_bytes({ ...address, workspace_path: input.file_path, ...input })
      : replace_volume_bytes({
          provider_volume_id: address.provider_volume_id,
          volume_relative_path: workspace_relative_key(address, input.file_path),
          data: input.data,
          expected_version: input.expected_version,
          content_version: input.content_version,
          ...(address.region ? { region: address.region } : {}),
        }),
  );
}

function workspace_relative_key(address: CloudVolumeAddress, workspace_path: string) {
  if (workspace_path === '') return address.volume_workspace_path;
  try {
    return workspace_object_key(address.volume_workspace_path, workspace_path);
  } catch (error) {
    throw new AppError(
      'workspace_path_invalid',
      format_error_message(error, 'The requested path is not inside the workspace.'),
      400,
    );
  }
}

async function with_readable_path_errors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (provider_error_status(error) === 404 || is_no_file_error(error)) {
      throw new AppError('workspace_file_not_found', 'That file no longer exists.', 404);
    }
    console.error('[workspace_volume_browser] provider call failed', error);
    throw new AppError(
      'workspace_storage_temporarily_unavailable',
      'Workspace files are not reachable right now. Try again in a moment.',
      503,
      { cause: format_error_message(error) },
    );
  }
}
