import {
  github_page_size,
  next_page_cursor,
  page_from_cursor,
  send_github_request,
  wait_for_code_search_slot,
} from '@connectors/apps/github/github_requests';
import definition from '@connectors/apps/github/search_code/v1/node.json' with { type: 'json' };
import type { ConnectorNodeContext } from '@connectors/types';

export type SearchCodeInput = { query: string; cursor?: string };

type CodeSearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: {
    name: string;
    path: string;
    sha: string;
    html_url: string;
    repository?: { full_name?: string | null } | null;
  }[];
};

const code_search_maximum_page = 1_000 / github_page_size;

export async function execute(input: SearchCodeInput, context: ConnectorNodeContext) {
  await wait_for_code_search_slot();

  const page = page_from_cursor(input.cursor);
  const response = await send_github_request<CodeSearchResponse>(context, {
    method: 'GET',
    path: '/search/code',
    query: { q: input.query, per_page: github_page_size, page },
    response_schema: definition.response_schema,
  });

  const page_cursor = next_page_cursor(page, response.items.length);
  return {
    items: response.items.map((item) => ({
      name: item.name,
      path: item.path,
      sha: item.sha,
      html_url: item.html_url,
      repository_full_name: item.repository?.full_name ?? null,
    })),
    total_count: response.total_count,
    incomplete_results: response.incomplete_results,
    next_cursor: page >= code_search_maximum_page ? null : page_cursor,
  };
}
