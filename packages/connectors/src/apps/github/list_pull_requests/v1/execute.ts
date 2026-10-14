import {
  find_item_outcome,
  type GithubRepoTarget,
  github_page_size,
  next_page_cursor,
  page_from_cursor,
  read_repo_name,
  safe_repo_name,
  send_github_request,
} from '@connectors/apps/github/github_requests';
import definition from '@connectors/apps/github/list_pull_requests/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';

export type ListPullRequestsInput = {
  repos: GithubRepoTarget[];
  state?: 'open' | 'closed' | 'all';
  base_branch?: string;
};

type GithubPullRequestRecord = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body?: string | null;
  draft?: boolean | null;
  user?: { login: string } | null;
  head?: { ref: string } | null;
  base?: { ref: string } | null;
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
};

function to_pull_request_output(pull_request: GithubPullRequestRecord) {
  return {
    number: pull_request.number,
    title: pull_request.title,
    state: pull_request.state,
    html_url: pull_request.html_url,
    body: pull_request.body ?? null,
    draft: pull_request.draft ?? false,
    author: pull_request.user?.login ?? null,
    head_branch: pull_request.head?.ref ?? null,
    base_branch: pull_request.base?.ref ?? null,
    created_time: pull_request.created_at,
    last_updated_time: pull_request.updated_at,
    merged_time: pull_request.merged_at ?? null,
  };
}

export async function execute(input: ListPullRequestsInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.repos,
    limits: context.app.rate_limits,
    call_one: async (target) => {
      const repository = read_repo_name(target);
      const page = page_from_cursor(target.cursor);
      const records = await send_github_request<GithubPullRequestRecord[]>(context, {
        method: 'GET',
        path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls`,
        query: {
          state: input.state,
          base: input.base_branch,
          per_page: github_page_size,
          page,
        },
        response_schema: definition.response_schema,
      });
      return {
        pull_requests: records.map(to_pull_request_output),
        next_cursor: next_page_cursor(page, records.length),
      };
    },
  });

  return {
    repos: input.repos.map((target, index) => {
      const outcome = find_item_outcome(results, index);
      const named = safe_repo_name(target);
      return {
        index,
        owner: named.owner,
        repo: named.repo,
        ok: outcome.ok,
        pull_requests: outcome.ok ? outcome.data.pull_requests : [],
        next_cursor: outcome.ok ? outcome.data.next_cursor : null,
        error: outcome.ok ? null : outcome.error,
      };
    }),
  };
}
