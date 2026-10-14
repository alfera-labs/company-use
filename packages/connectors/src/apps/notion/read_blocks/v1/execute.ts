import { find_item_outcome, send_notion_request } from '@connectors/apps/notion/notion_requests';
import {
  join_rich_text_to_plain_text,
  type NotionRichTextSpan,
} from '@connectors/apps/notion/notion_text';
import node_definition from '@connectors/apps/notion/read_blocks/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

type BlockToRead = {
  block_id: string;
  cursor?: string;
  limit?: number;
};

export type ReadBlocksInput = { blocks: BlockToRead[] };

type NotionBlockRecord = { id: string; type: string; has_children?: boolean | null } & Record<
  string,
  unknown
>;

type NotionBlockContent = { rich_text?: NotionRichTextSpan[] | null };

type NotionBlockChildrenResponse = {
  results: NotionBlockRecord[];
  next_cursor?: string | null;
  has_more?: boolean | null;
};

const block_children_schema = node_definition.response_schemas.block_children as JsonSchema;

function find_block_text(block: NotionBlockRecord) {
  const content = block[block.type] as NotionBlockContent | undefined;
  const spans = content?.rich_text;
  return join_rich_text_to_plain_text(Array.isArray(spans) ? spans : null);
}

export async function execute(input: ReadBlocksInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.blocks,
    limits: context.app.rate_limits,
    call_one: (block) =>
      send_notion_request<NotionBlockChildrenResponse>(context, {
        method: 'GET',
        path: `/blocks/${encodeURIComponent(block.block_id)}/children`,
        query: { start_cursor: block.cursor, page_size: block.limit },
        response_schema: block_children_schema,
      }),
  });

  return {
    results: input.blocks.map((block, index) => {
      const outcome = find_item_outcome(results, index);
      return {
        index,
        block_id: block.block_id,
        ok: outcome.ok,
        blocks: outcome.ok
          ? outcome.data.results.map((record) => ({
              id: record.id,
              type: record.type,
              text: find_block_text(record),
              has_children: record.has_children ?? false,
            }))
          : [],
        next_cursor: outcome.ok ? (outcome.data.next_cursor ?? null) : null,
        has_more: outcome.ok ? (outcome.data.has_more ?? false) : false,
        error: outcome.ok ? null : outcome.error,
      };
    }),
  };
}
