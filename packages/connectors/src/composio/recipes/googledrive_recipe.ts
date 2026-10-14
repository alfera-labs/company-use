import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

const files_not_folders = "mimeType != 'application/vnd.google-apps.folder'";

const docx_mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const xlsx_mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const pptx_mime_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const googledrive_recipe: ComposioRecipe = {
  toolkit_slug: 'GOOGLEDRIVE',
  preferred_provider: 'native',
  app_display_name: 'Google Drive',
  prompt: 'Choose which Google Drive folders to sync',
  dimensions: [
    {
      key: 'folders',
      label: 'Folders',
      shape: 'tree',
      list_scope_options: {
        node_key: 'google_drive_v2-find_folder-1',
        input: { page_size: 1000 },
      },
      list_children: {
        node_key: 'google_drive_v2-find_folder-1',
        input: { page_size: 1000 },
        parent_id_param: 'parent_folder_id',
      },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $default: [{ $: 'item.name' }, { $: 'item.id' }] },
        kind: 'folder',
        selectable: true,
      },
      allow_select_all: true,
      select_all_lists_unscoped: true,
    },
  ],
  objects: {
    document: {
      label: 'File',
      list_items: {
        node_key: 'google_drive_v2-find_file-1',
        input: {
          q: files_not_folders,
          pageSize: 25,
          fields:
            'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,webViewLink,trashed,owners,description,parents)',
        },
      },
      scoped_by: {
        folders: 'folder_id',
      },
      page: {
        cursor_param: 'pageToken',
        items: { $: 'response.files' },
        next_cursor: { $: 'response.nextPageToken' },
      },
      strategy: 'modified_since',
      cursor: {
        field: { $: 'item.modifiedTime' },
        param: 'q',
        marker_format: 'iso_time',
        overlap_minutes: 5,
        template: {
          text: `${files_not_folders} and modifiedTime > '{watermark}'`,
          escape: 'backslash_quote',
        },
      },
      identity: { $: 'item.id' },
      version_signal: { $: 'item.modifiedTime' },
      tombstone: { $: 'item.trashed' },
      title: { $default: [{ $: 'item.name' }, { $: 'item.id' }] },
      content: { $default: [{ $: 'item.description' }, { $: 'item.name' }] },
      download_item: {
        node_key: 'google_drive_v2-download_file-1',
        file_id_param: 'fileId',
        export_param: 'mime_type',
        file_id: { $: 'item.id' },
        mime_type: { $: 'item.mimeType' },
        size_bytes: { $: 'item.size' },
        export_formats: {
          'application/vnd.google-apps.document': docx_mime_type,
          'application/vnd.google-apps.spreadsheet': xlsx_mime_type,
          'application/vnd.google-apps.presentation': pptx_mime_type,
        },
      },
      item_kind: 'file',
      container: { id: { $: 'scope.id' } },
      path: {
        parent_chain: {
          parent_ids: { $: 'item.parents' },
          folders: {
            node_key: 'google_drive_v2-find_folder-1',
            input: { page_size: 1000 },
            page: {
              cursor_param: 'page_token',
              items: { $: 'response.files' },
              next_cursor: { $: 'response.nextPageToken' },
            },
            id: { $: 'item.id' },
            name: { $default: [{ $: 'item.name' }, { $: 'item.id' }] },
            parent_id: { $: 'item.parents.0' },
          },
          root_name: 'My Drive',
          no_parent_name: 'Shared with me',
        },
      },
      metadata: {
        mime_type: { $: 'item.mimeType' },
        size_bytes: { $: 'item.size' },
        modified_time: { $: 'item.modifiedTime' },
        owner: { $: 'item.owners' },
      },
      source_url: { $: 'item.webViewLink' },
      note: 'Composio GOOGLEDRIVE_FIND_FILE (successor of the deprecated GOOGLEDRIVE_LIST_FILES) scoped to one folder by folder_id, folders excluded by q. The first sync lists every file. Later syncs send the watermark inside q (modifiedTime > watermark, backslash-escaped), so only changed files come back; modifiedTime stays the version signal. A trashed file whose modifiedTime did not move, or a file deleted outright, is not seen by an incremental walk. Select-all runs one FIND_FILE listing with no folder filter, so root files and nested files all come back. Picked folder scopes come from GOOGLEDRIVE_FIND_FOLDER, children by parent_folder_id. Content is the real text: GOOGLEDRIVE_DOWNLOAD_FILE fetches each file (Docs export to docx, Sheets to xlsx, Slides to pptx), the document converter turns it into markdown, and the description or name is the logged fallback. The native google_drive app is preferred when it is not held.',
    },
  },
};
