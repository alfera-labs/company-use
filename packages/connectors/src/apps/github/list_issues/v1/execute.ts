import {
  find_item_outcome,
  type GithubIssueRecord,
  type GithubRepoTarget,
  github_page_size,
  next_page_cursor,
  page_from_cursor,
  read_repo_name,
  safe_repo_name,
  send_github_request,
  to_github_issue_output,
} from '@connectors/apps/github/github_requests';
import definition from '@connectors/apps/github/list_issues/v1/node.json' with { type: 'json' };
import type { ConnectorNodeContext } from '@connectors/types';

export type ListIssuesInput = {
  repos: GithubRepoTarget[];
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  since?: string;
};

export async function execute(input: ListIssuesInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.repos,
    limits: context.app.rate_limits,
    call_one: async (target) => {
      const repository = read_repo_name(target);
      const page = page_from_cursor(target.cursor);
      const records = await send_github_request<GithubIssueRecord[]>(context, {
        method: 'GET',
        path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues`,
        query: {
          state: input.state,
          labels: input.labels?.join(','),
          since: input.since,
          per_page: github_page_size,
          page,
        },
        response_schema: definition.response_schema,
      });
      return {
        issues: records.filter((record) => !record.pull_request).map(to_github_issue_output),
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
        issues: outcome.ok ? outcome.data.issues : [],
        next_cursor: outcome.ok ? outcome.data.next_cursor : null,
        error: outcome.ok ? null : outcome.error,
      };
    }),
  };
}
