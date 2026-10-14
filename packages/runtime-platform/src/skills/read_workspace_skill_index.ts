import type { Database } from '@coworker/core/db/connection';
import { find_volume } from '@coworker/core/db/queries/volumes';
import { create_logger, format_error_message } from '@coworker/shared';
import { is_procedure_folder_name } from '@runtime-platform/skills/procedure_folders';
import {
  empty_skill_index,
  read_skill_index,
  type SkillIndex,
  skill_index_file_name,
  skill_index_from_procedure_folders,
} from '@runtime-platform/skills/skill_index_artifact';
import { find_host_workspace_address } from '@runtime-platform/storage/host_volume';
import {
  list_host_workspace_entries,
  read_host_workspace_bytes,
} from '@runtime-platform/storage/host_volume_objects';
import {
  list_archil_volume_folders,
  read_archil_volume_bytes,
} from '@runtime-platform/storage/volume_objects';
import {
  procedures_folder,
  volume_workspace_path,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';

const log = create_logger('read_workspace_skill_index');

type WorkspaceSkillOwner = {
  workspace_id: string;
  agent_id: string;
  workspace_runtime_provider?: 'local' | 'docker' | 'e2b';
  workspace_base_path?: string;
};

export async function read_workspace_skill_index(
  db: Database,
  input: WorkspaceSkillOwner,
  read_volume_bytes: typeof read_archil_volume_bytes = read_archil_volume_bytes,
  list_volume_folders: typeof list_archil_volume_folders = list_archil_volume_folders,
): Promise<SkillIndex> {
  const volume = await find_volume(db, input.workspace_id).catch(() => undefined);
  if (!volume) return read_host_workspace_skill_index(input);
  if (volume.volume_provider !== 'archil' || !volume.provider_volume_id) {
    return empty_skill_index;
  }

  let folder_path: string;
  try {
    const layout = workspace_layout_for_version(volume.volume_config.workspace_layout_version);
    folder_path = `${volume_workspace_path(input.agent_id, layout)}/${procedures_folder}`;
  } catch (error) {
    log.warn('Could not resolve where this workspace keeps its procedures.', {
      workspace_id: input.workspace_id,
      error: format_error_message(error),
    });
    return empty_skill_index;
  }

  const address = {
    provider_volume_id: volume.provider_volume_id,
    ...(volume.provider_region ? { region: volume.provider_region } : {}),
  };

  const index_path = `${folder_path}/${skill_index_file_name}`;
  const compiled = await read_compiled_index(
    () => read_volume_bytes({ ...address, volume_relative_path: index_path }),
    input.workspace_id,
  );
  if (compiled) return compiled;

  return list_procedures_on_volume(
    () => list_volume_folders({ ...address, volume_relative_path: folder_path }),
    input.workspace_id,
  );
}

async function read_host_workspace_skill_index(input: WorkspaceSkillOwner): Promise<SkillIndex> {
  const address = await find_host_workspace_address(input);
  if (!address) return empty_skill_index;
  const file = (workspace_path: string) => ({
    host_workspace_root: address.host_workspace_root,
    workspace_path,
  });
  const compiled = await read_compiled_index(
    () => read_host_workspace_bytes(file(`${procedures_folder}/${skill_index_file_name}`)),
    input.workspace_id,
  );
  if (compiled) return compiled;

  return list_procedures_on_volume(
    async () => (await list_host_workspace_entries(file(procedures_folder))).folder_names,
    input.workspace_id,
  );
}

async function read_compiled_index(
  read_index_bytes: () => Promise<Uint8Array>,
  workspace_id: string,
): Promise<SkillIndex | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await read_index_bytes();
  } catch (error) {
    log.debug('No workspace skill index on the volume.', {
      workspace_id,
      error: format_error_message(error),
    });
    return undefined;
  }

  const parsed = read_skill_index(Buffer.from(bytes).toString('utf8'));
  if (parsed.ok) return parsed.index;
  log.warn('Workspace skill index could not be read. Falling back to the folder.', {
    workspace_id,
    bytes_read: bytes.byteLength,
    reason: parsed.failure.reason,
    detail: parsed.failure.detail,
  });
  return undefined;
}

async function list_procedures_on_volume(
  list_folder_names: () => Promise<string[]>,
  workspace_id: string,
): Promise<SkillIndex> {
  let folder_names: string[];
  try {
    folder_names = await list_folder_names();
  } catch (error) {
    log.warn('Could not list the workspace procedures folder.', {
      workspace_id,
      error: format_error_message(error),
    });
    return empty_skill_index;
  }

  const skill_slugs = folder_names.filter(is_procedure_folder_name);
  if (skill_slugs.length === 0) return empty_skill_index;
  log.warn('Offering workspace procedures from the folder, without their hints.', {
    workspace_id,
    skill_slugs,
  });
  return skill_index_from_procedure_folders(skill_slugs, procedures_folder);
}
