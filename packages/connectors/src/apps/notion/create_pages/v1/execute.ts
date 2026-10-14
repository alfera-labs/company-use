import node_definition from '@connectors/apps/notion/create_pages/v1/node.json' with {
  type: 'json',
};
import {
  find_item_outcome,
  resolve_data_source_id,
  send_notion_request,
} from '@connectors/apps/notion/notion_requests';
import { find_page_title, type NotionPageProperties } from '@connectors/apps/notion/notion_text';
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type PageParent = {
  data_source_id?: string;
  database_id?: string;
  page_id?: string;
};

type PageToCreate = {
  parent: PageParent;
  properties: Record<string, unknown>;
  children_markdown?: string;
};

export type CreatePagesInput = { pages: PageToCreate[] };

type NotionCreatedPage = {
  id: string;
  url?: string | null;
  properties?: NotionPageProperties | null;
};

const created_page_schema = node_definition.response_schemas.created_page as JsonSchema;
const database_schema = node_definition.response_schemas.database as JsonSchema;

const heading_rules = [
  { marker: '### ', block_type: 'heading_3' },
  { marker: '## ', block_type: 'heading_2' },
  { marker: '# ', block_type: 'heading_1' },
] as const;

const bullet_markers = ['- ', '* '] as const;

const maximum_span_length = 2000;

const maximum_blocks_per_page = 100;

type NotionBlockRequest = { object: 'block'; type: string; [content_key: string]: unknown };

function split_text_into_spans(text: string) {
  const spans: { type: 'text'; text: { content: string } }[] = [];
  for (let start = 0; start < text.length; start += maximum_span_length) {
    spans.push({ type: 'text', text: { content: text.slice(start, start + maximum_span_length) } });
  }
  return spans;
}

function build_block(block_type: string, text: string): NotionBlockRequest {
  return {
    object: 'block',
    type: block_type,
    [block_type]: { rich_text: split_text_into_spans(text) },
  };
}

function build_block_for_line(line: string) {
  const heading = heading_rules.find((rule) => line.startsWith(rule.marker));
  if (heading) return build_block(heading.block_type, line.slice(heading.marker.length).trim());
  const bullet = bullet_markers.find((marker) => line.startsWith(marker));
  if (bullet) return build_block('bulleted_list_item', line.slice(bullet.length).trim());
  return build_block('paragraph', line);
}

function convert_markdown_to_notion_blocks(markdown: string): NotionBlockRequest[] {
  const blocks = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(build_block_for_line);
  if (blocks.length > maximum_blocks_per_page) {
    throw new Error(
      `Notion accepts at most ${maximum_blocks_per_page} blocks when creating a page; this markdown makes ${blocks.length}. Create the page, then append the rest.`,
    );
  }
  return blocks;
}

async function build_page_parent(context: ConnectorNodeContext, parent: PageParent) {
  if (parent.page_id) return { type: 'page_id', page_id: parent.page_id };
  const data_source_id = await resolve_data_source_id(context, parent, database_schema);
  return { type: 'data_source_id', data_source_id };
}

export async function execute(input: CreatePagesInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.pages,
    limits: context.app.rate_limits,
    call_one: async (page) => {
      const parent = await build_page_parent(context, page.parent);
      const children =
        page.children_markdown === undefined
          ? []
          : convert_markdown_to_notion_blocks(page.children_markdown);
      return send_notion_request<NotionCreatedPage>(context, {
        method: 'POST',
        path: '/pages',
        body: {
          parent,
          properties: page.properties,
          ...(children.length > 0 ? { children } : {}),
        },
        response_schema: created_page_schema,
      });
    },
  });

  return {
    results: input.pages.map((_page, index) => {
      const outcome = find_item_outcome(results, index);
      return {
        index,
        ok: outcome.ok,
        page_id: outcome.ok ? outcome.data.id : null,
        title: outcome.ok ? find_page_title(outcome.data.properties) : null,
        url: outcome.ok ? (outcome.data.url ?? null) : null,
        error: outcome.ok ? null : outcome.error,
      };
    }),
  };
}
