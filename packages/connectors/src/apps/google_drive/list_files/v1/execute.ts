import definition from '@connectors/apps/google_drive/list_files/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type ListDriveFilesInput = {
  query?: string;
  folder_ids?: string[];
  mime_types?: string[];
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
};

type FilePage = {
  files?: DriveFile[];
  nextPageToken?: string | null;
};

const files_list = definition.requests.files_list;
const response_schema = files_list.response_schema as JsonSchema;

function quote_drive_query_value(value: string) {
  return `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`;
}

function build_drive_query(input: ListDriveFilesInput) {
  const clauses = ['trashed = false'];
  if (input.query) clauses.push(`fullText contains ${quote_drive_query_value(input.query)}`);
  const folders = input.folder_ids ?? [];
  if (folders.length > 0) {
    const parents = folders.map((id) => `${quote_drive_query_value(id)} in parents`);
    clauses.push(`(${parents.join(' or ')})`);
  }
  const mime_types = input.mime_types ?? [];
  if (mime_types.length > 0) {
    const types = mime_types.map((type) => `mimeType = ${quote_drive_query_value(type)}`);
    clauses.push(`(${types.join(' or ')})`);
  }
  return clauses.join(' and ');
}

export async function execute(input: ListDriveFilesInput, context: ConnectorNodeContext) {
  const page = await context.send_request<FilePage>({
    method: 'GET',
    path: files_list.path,
    query: {
      q: build_drive_query(input),
      fields: files_list.query.fields,
      orderBy: files_list.query.orderBy,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageToken: input.cursor,
      pageSize: input.limit,
    },
    response_schema,
  });

  return {
    files: (page.files ?? []).flatMap((file) =>
      file.id && file.name && file.mimeType
        ? [
            {
              id: file.id,
              name: file.name,
              mime_type: file.mimeType,
              modified_time: file.modifiedTime ?? null,
              version: file.version ?? null,
              web_view_link: file.webViewLink ?? null,
              parent_ids: file.parents ?? [],
            },
          ]
        : [],
    ),
    next_cursor: page.nextPageToken ?? null,
  };
}
