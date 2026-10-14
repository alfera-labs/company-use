import definition from '@connectors/apps/google_drive/list_folders/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type ListDriveFoldersInput = {
  parent_id?: string;
  query?: string;
  cursor?: string;
  limit?: number;
};

type DriveFolder = {
  id?: string;
  name?: string;
};

type FolderPage = {
  files?: DriveFolder[];
  nextPageToken?: string | null;
};

export type ScopeOption = {
  id: string;
  label: string;
  kind: string;
  has_children: boolean;
  selectable: boolean;
};

export type ListDriveFoldersOutput = {
  options: ScopeOption[];
  next_cursor: string | null;
};

const folders_list = definition.requests.folders_list;
const response_schema = folders_list.response_schema as JsonSchema;

export const drive_folder_mime_type = 'application/vnd.google-apps.folder';

export const drive_root_folder_id = 'root';

function quote_drive_query_value(value: string) {
  return `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`;
}

function build_drive_folder_query(input: ListDriveFoldersInput) {
  const parent_id = input.parent_id ?? drive_root_folder_id;
  const clauses = [
    'trashed = false',
    `mimeType = ${quote_drive_query_value(drive_folder_mime_type)}`,
    `${quote_drive_query_value(parent_id)} in parents`,
  ];
  if (input.query) clauses.push(`name contains ${quote_drive_query_value(input.query)}`);
  return clauses.join(' and ');
}

export async function execute(
  input: ListDriveFoldersInput,
  context: ConnectorNodeContext,
): Promise<ListDriveFoldersOutput> {
  const page = await context.send_request<FolderPage>({
    method: 'GET',
    path: folders_list.path,
    query: {
      q: build_drive_folder_query(input),
      fields: folders_list.query.fields,
      orderBy: folders_list.query.orderBy,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageToken: input.cursor,
      pageSize: input.limit,
    },
    response_schema,
  });

  return {
    options: (page.files ?? []).flatMap((folder) =>
      folder.id && folder.name
        ? [
            {
              id: folder.id,
              label: folder.name,
              kind: 'folder',
              has_children: true,
              selectable: true,
            },
          ]
        : [],
    ),
    next_cursor: page.nextPageToken ?? null,
  };
}
