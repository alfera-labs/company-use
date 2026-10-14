import type { WorkspaceFileEntry, WorkspaceFolderEntry } from '@/lib/api';

const scratch_folder_name = 'tmp';

/**
 * True for a name the Files panel shows only when the person asks for hidden items: a name
 * that starts with a dot, and the scratch folder at the top of the workspace.
 */
export function is_hidden_workspace_entry(entry_name: string, folder_path: string) {
  return entry_name.startsWith('.') || (folder_path === '' && entry_name === scratch_folder_name);
}

/**
 * One folder in the order the Files panel shows it: the folders that hold files, then the
 * files with the newest first, then the empty folders. A folder that does not say whether it
 * is empty stays with the folders that hold files.
 */
export function order_workspace_listing(
  listing: { folders: WorkspaceFolderEntry[]; files: WorkspaceFileEntry[] },
  shown: { folder_path: string; name_filter: string; show_hidden: boolean },
) {
  const name_filter = shown.name_filter.trim().toLowerCase();
  const is_hidden = (name: string) => is_hidden_workspace_entry(name, shown.folder_path);
  const is_shown = (name: string) =>
    name.toLowerCase().includes(name_filter) && (shown.show_hidden || !is_hidden(name));
  const folders = listing.folders.filter((folder) => is_shown(folder.folder_name));
  return {
    folders: folders.filter((folder) => !folder.is_empty),
    files: listing.files.filter((file) => is_shown(file.file_name)).sort(newest_file_first),
    empty_folders: folders.filter((folder) => folder.is_empty),
    hidden_count:
      listing.folders.filter((folder) => is_hidden(folder.folder_name)).length +
      listing.files.filter((file) => is_hidden(file.file_name)).length,
  };
}

function newest_file_first(first: WorkspaceFileEntry, second: WorkspaceFileEntry) {
  const first_time = first.last_modified_time ?? '';
  const second_time = second.last_modified_time ?? '';
  if (first_time === second_time) return 0;
  return first_time < second_time ? 1 : -1;
}
