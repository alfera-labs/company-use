import type {
  ConnectorError,
  ConnectorFanOutItemResult,
  ConnectorHttpMethod,
  ConnectorNodeContext,
  ConnectorQuery,
} from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const notion_api_version = '2026-03-11';

const notion_request_headers: Record<string, string> = {
  'Notion-Version': notion_api_version,
};

export type NotionRequest = {
  method: ConnectorHttpMethod;
  path: string;
  query?: ConnectorQuery;
  body?: unknown;
  response_schema: JsonSchema;
};

export function send_notion_request<TParsed>(
  context: ConnectorNodeContext,
  request: NotionRequest,
): Promise<TParsed> {
  return context.send_request<TParsed>({
    method: request.method,
    path: request.path,
    ...(request.query === undefined ? {} : { query: request.query }),
    ...(request.body === undefined ? {} : { body: request.body }),
    headers: notion_request_headers,
    response_schema: request.response_schema,
  });
}

type ItemOutcome<TData> = { ok: true; data: TData } | { ok: false; error: ConnectorError };

export function find_item_outcome<TData>(
  results: readonly ConnectorFanOutItemResult<TData>[],
  index: number,
): ItemOutcome<TData> {
  const result = results[index];
  if (!result) {
    return {
      ok: false,
      error: {
        code: 'node_failed',
        message: `Notion returned no result for item ${index}.`,
        retryable: false,
      },
    };
  }
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
}

export type NotionDatabaseRecord = {
  id: string;
  data_sources?: { id: string; name?: string | null }[] | null;
};

export type NotionDataSourceIds = {
  data_source_id?: string | undefined;
  database_id?: string | undefined;
};

export async function resolve_data_source_id(
  context: ConnectorNodeContext,
  ids: NotionDataSourceIds,
  database_schema: JsonSchema,
) {
  if (ids.data_source_id) return ids.data_source_id;
  if (!ids.database_id) throw new Error('Give either data_source_id or database_id.');

  const database = await send_notion_request<NotionDatabaseRecord>(context, {
    method: 'GET',
    path: `/databases/${encodeURIComponent(ids.database_id)}`,
    response_schema: database_schema,
  });
  const first_data_source = (database.data_sources ?? []).at(0);
  if (!first_data_source) {
    throw new Error(
      `Notion database ${ids.database_id} holds no data source, so there is nothing to read or write.`,
    );
  }
  return first_data_source.id;
}
