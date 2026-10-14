import {
  find_item_outcome,
  resolve_data_source_id,
  send_notion_request,
} from '@connectors/apps/notion/notion_requests';
import { find_page_title, type NotionPageProperties } from '@connectors/apps/notion/notion_text';
import node_definition from '@connectors/apps/notion/query_databases/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

type DatabaseQuery = {
  data_source_id?: string;
  database_id?: string;
  filter?: Record<string, unknown>;
  sorts?: Record<string, unknown>[];
  cursor?: string;
  limit?: number;
};

export type QueryDatabasesInput = { queries: DatabaseQuery[] };

type NotionQueryResponse = {
  results: {
    id: string;
    url?: string | null;
    last_edited_time?: string | null;
    properties?: NotionPageProperties | null;
  }[];
  next_cursor?: string | null;
  has_more?: boolean | null;
};

const query_schema = node_definition.response_schemas.query as JsonSchema;
const database_schema = node_definition.response_schemas.database as JsonSchema;

export async function execute(input: QueryDatabasesInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.queries,
    limits: context.app.rate_limits,
    call_one: async (query) => {
      const data_source_id = await resolve_data_source_id(context, query, database_schema);
      const response = await send_notion_request<NotionQueryResponse>(context, {
        method: 'POST',
        path: `/data_sources/${encodeURIComponent(data_source_id)}/query`,
        body: {
          ...(query.filter === undefined ? {} : { filter: query.filter }),
          ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
          ...(query.cursor === undefined ? {} : { start_cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { page_size: query.limit }),
        },
        response_schema: query_schema,
      });
      return { data_source_id, response };
    },
  });

  return {
    results: input.queries.map((_query, index) => {
      const outcome = find_item_outcome(results, index);
      return {
        index,
        data_source_id: outcome.ok ? outcome.data.data_source_id : null,
        ok: outcome.ok,
        rows: outcome.ok
          ? outcome.data.response.results.map((row) => ({
              id: row.id,
              title: find_page_title(row.properties),
              url: row.url ?? null,
              last_edited_time: row.last_edited_time ?? null,
              properties: row.properties ?? {},
            }))
          : [],
        next_cursor: outcome.ok ? (outcome.data.response.next_cursor ?? null) : null,
        has_more: outcome.ok ? (outcome.data.response.has_more ?? false) : false,
        error: outcome.ok ? null : outcome.error,
      };
    }),
  };
}
