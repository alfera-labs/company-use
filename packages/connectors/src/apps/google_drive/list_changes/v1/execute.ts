import definition from '@connectors/apps/google_drive/list_changes/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type ListDriveChangesInput = {
  cursor?: string;
  limit?: number;
};

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  version?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
};

type DriveChange = {
  fileId?: string;
  changeType?: string;
  time?: string;
  removed?: boolean;
  driveId?: string;
  file?: DriveFile | null;
};

type StartPageToken = { startPageToken: string };

type ChangesPage = {
  changes?: DriveChange[];
  nextPageToken?: string | null;
  newStartPageToken?: string | null;
};

const changes_start_page_token = definition.requests.changes_start_page_token;
const changes_list = definition.requests.changes_list;
const start_page_token_schema = changes_start_page_token.response_schema as JsonSchema;
const changes_page_schema = changes_list.response_schema as JsonSchema;

function to_change_output(change: DriveChange) {
  const file = change.file;
  return {
    file_id: change.fileId ?? null,
    change_type: change.changeType ?? null,
    time: change.time ?? null,
    removed: change.removed ?? false,
    drive_id: change.driveId ?? null,
    file:
      file?.id && file.name && file.mimeType
        ? {
            id: file.id,
            name: file.name,
            mime_type: file.mimeType,
            modified_time: file.modifiedTime ?? null,
            version: file.version ?? null,
            web_view_link: file.webViewLink ?? null,
            parent_ids: file.parents ?? [],
            trashed: file.trashed ?? false,
          }
        : null,
  };
}

export async function execute(input: ListDriveChangesInput, context: ConnectorNodeContext) {
  if (!input.cursor) {
    const start = await context.send_request<StartPageToken>({
      method: 'GET',
      path: changes_start_page_token.path,
      query: { supportsAllDrives: true },
      response_schema: start_page_token_schema,
    });
    return { changes: [], next_cursor: start.startPageToken, has_more: false };
  }

  const page = await context.send_request<ChangesPage>({
    method: 'GET',
    path: changes_list.path,
    query: {
      pageToken: input.cursor,
      pageSize: input.limit,
      fields: changes_list.query.fields,
      includeRemoved: true,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    },
    response_schema: changes_page_schema,
  });

  return {
    changes: (page.changes ?? []).map(to_change_output),
    next_cursor: page.nextPageToken ?? page.newStartPageToken ?? null,
    has_more: Boolean(page.nextPageToken),
  };
}
