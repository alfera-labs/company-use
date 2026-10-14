import { send_notion_request } from '@connectors/apps/notion/notion_requests';
import {
  find_page_title,
  find_title_spans,
  join_rich_text_to_plain_text,
  type NotionPageProperties,
  type NotionTitleValue,
} from '@connectors/apps/notion/notion_text';
import node_definition from '@connectors/apps/notion/search_pages/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type SearchPagesInput = {
  query?: string | undefined;
  filter_object_type?: 'page' | 'data_source' | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

type NotionSearchResponse = {
  results: {
    object?: string | null;
    id: string;
    url?: string | null;
    last_edited_time?: string | null;
    title?: NotionTitleValue;
    properties?: NotionPageProperties | null;
  }[];
  next_cursor?: string | null;
  has_more?: boolean | null;
};

const search_schema = node_definition.response_schemas.search as JsonSchema;

export async function execute(input: SearchPagesInput, context: ConnectorNodeContext) {
  const response = await send_notion_request<NotionSearchResponse>(context, {
    method: 'POST',
    path: '/search',
    body: {
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.filter_object_type === undefined
        ? {}
        : { filter: { property: 'object', value: input.filter_object_type } }),
      ...(input.cursor === undefined ? {} : { start_cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { page_size: input.limit }),
    },
    response_schema: search_schema,
  });

  return {
    results: response.results.map((result) => ({
      id: result.id,
      object: result.object ?? null,
      title:
        join_rich_text_to_plain_text(find_title_spans(result.title)) ||
        find_page_title(result.properties),
      url: result.url ?? null,
      last_edited_time: result.last_edited_time ?? null,
    })),
    next_cursor: response.next_cursor ?? null,
    has_more: response.has_more ?? false,
  };
}
