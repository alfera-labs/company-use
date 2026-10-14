import type { RuntimeEnvironmentData } from '@coworker/core';
import { volume_root_path } from '@coworker/core/db/queries/volumes';
import type { OpenVolume } from '@runtime-platform/storage/volume_runtime';
import {
  volume_workspace_path,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';

export function volume_metadata(volume: OpenVolume, agent_id?: string) {
  return {
    volume_id: volume.volume_id,
    volume_provider: volume.provider,
    volume_root_path: volume.root_path,
    workspace_layout_version: volume.workspace_layout_version,
    ...(agent_id
      ? {
          agent_workspace_path: volume_workspace_path(
            agent_id,
            workspace_layout_for_version(volume.workspace_layout_version),
          ),
        }
      : {}),
  };
}

/**
 * The layout this environment's volume is on. Absent on a row written before the field
 * existed, which is the oldest layout by definition.
 */
export function read_workspace_layout_version(metadata: RuntimeEnvironmentData) {
  const value = metadata.workspace_layout_version;
  return typeof value === 'number' ? value : undefined;
}

/**
 * The agent workspace this environment mounted, relative to the volume root. Absent on an
 * environment started before the layout carried one, where the whole volume was the tree.
 */
export function read_agent_workspace_path(metadata: RuntimeEnvironmentData) {
  const path_value = metadata.agent_workspace_path;
  return typeof path_value === 'string' && path_value.length > 0 ? path_value : null;
}

/**
 * Where this environment's workspace sits on its volume, for reading its objects without a
 * sandbox. The environment recorded it at creation; an environment made before that field
 * existed is on a layout whose workspace is one folder at the volume root, and that folder
 * name comes off the layout record rather than a literal repeated here.
 *
 * A layout that keys the workspace by agent and recorded nothing raises: writing an
 * unresolved `{agent_id}` into an object key would read a folder that cannot exist and
 * report it as an empty workspace.
 */
export function read_volume_workspace_path(metadata: RuntimeEnvironmentData) {
  const recorded = read_agent_workspace_path(metadata);
  if (recorded) return recorded;
  const layout = workspace_layout_for_version(read_workspace_layout_version(metadata));
  if (layout.volume_workspace_path.includes('{agent_id}')) {
    throw new Error(
      `Environment on workspace layout ${layout.layout_version} recorded no agent workspace path.`,
    );
  }
  return layout.volume_workspace_path;
}

export function read_volume_id(metadata: RuntimeEnvironmentData) {
  return metadata.volume_id && metadata.volume_id.length > 0 ? metadata.volume_id : null;
}

export function read_volume_provider(metadata: RuntimeEnvironmentData) {
  return metadata.volume_provider ?? null;
}

export function read_volume_root_path(metadata: RuntimeEnvironmentData) {
  return metadata.volume_root_path?.startsWith('/') ? metadata.volume_root_path : volume_root_path;
}
