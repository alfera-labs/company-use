import {
  list_workspace_volume_folder,
  type WorkspaceVolumeAddress,
  workspace_folder_description,
} from '@coworker/runtime-platform';
import { list_empty_host_folder_names } from '@runtime-platform/storage/host_volume_objects';

type ListedWorkspaceFolder = {
  folder_name: string;
  description: string | null;
  is_empty?: boolean;
};

/**
 * One folder of the workspace as the Files panel lists it. A subfolder says whether it is
 * empty only where the storage can tell without a read of the whole tree: today that is a
 * workspace kept on this machine's disk. On a cloud volume the field is absent.
 */
export async function list_workspace_files_folder(
  address: WorkspaceVolumeAddress,
  folder_path: string,
  list_volume_entries?: Parameters<typeof list_workspace_volume_folder>[2],
) {
  const listed = await list_workspace_volume_folder(address, folder_path, list_volume_entries);
  const empty_folder_names =
    'host_workspace_root' in address
      ? await list_empty_host_folder_names({ ...address, workspace_path: folder_path })
      : null;
  const folders: ListedWorkspaceFolder[] = listed.folder_names.map((folder_name) => ({
    folder_name,
    description:
      folder_path === '' ? workspace_folder_description(address.layout, folder_name) : null,
    ...(empty_folder_names ? { is_empty: empty_folder_names.includes(folder_name) } : {}),
  }));
  return { folders, files: listed.files };
}
