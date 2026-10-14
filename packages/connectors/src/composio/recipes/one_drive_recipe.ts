import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const one_drive_recipe: ComposioRecipe = {
  toolkit_slug: 'ONE_DRIVE',
  app_display_name: 'OneDrive',
  prompt: 'Choose which OneDrive folders to sync',
  dimensions: [
    {
      key: 'folders',
      label: 'Folders',
      shape: 'tree',
      list_scope_options: {
        node_key: 'one_drive-list_folder_children-1',
        input: { use_me_drive: true, folder_path: '/' },
      },
      list_children: {
        node_key: 'one_drive-list_folder_children-1',
        input: { use_me_drive: true },
        parent_id_param: 'folder_item_id',
      },
      search: { node_key: 'one_drive-search_items-1', query_param: 'q' },
      option_when: { $: 'item.folder' },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $default: [{ $: 'item.name' }, { $: 'item.id' }] },
        kind: 'folder',
        selectable: true,
      },
      allow_select_all: true,
    },
  ],
  objects: {
    document: {
      label: 'File',
      list_items: {
        node_key: 'one_drive-list_folder_children-1',
        input: { use_me_drive: true, top: 200 },
      },
      when: { $: 'item.file' },
      scoped_by: {
        folders: 'folder_item_id',
      },
      page: {
        cursor_param: 'page_token',
        items: { $: 'response.value' },
        next_cursor: { $: 'response.next_page_token' },
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.eTag' },
      title: { $: 'item.name' },
      content: { $default: [{ $: 'item.description' }, { $: 'item.name' }] },
      item_kind: 'file',
      container: { id: { $: 'scope.id' } },
      path: {
        segments: [
          { text: { $: 'item.parentReference.path' }, strip_prefix: '/drive/root:', split_on: '/' },
        ],
      },
      metadata: {
        mime_type: { $: 'item.file.mimeType' },
        size_bytes: { $: 'item.size' },
        web_url: { $: 'item.webUrl' },
      },
      source_url: { $: 'item.webUrl' },
      note: 'Composio toolkit slug is one_drive (ONE_DRIVE), not onedrive; ONE_DRIVE_LIST_FOLDER_CONTENTS and ONE_DRIVE_LIST_FILES do not exist. ONE_DRIVE_LIST_FOLDER_CHILDREN lists both folders and files by folder_item_id, has no modified-since filter, so this re-lists and diffs by identity, keeps only items with a file facet, and uses eTag as the version signal. Composio cannot download file bytes into memory today, so content is the description or the name.',
    },
  },
};
