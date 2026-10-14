import definition from '@connectors/apps/github/create_issues/v1/node.json' with { type: 'json' };
import {
  find_item_outcome,
  type GithubIssueRecord,
  send_github_request,
  to_github_issue_output,
} from '@connectors/apps/github/github_requests';
import type { ConnectorNodeContext } from '@connectors/types';

export type CreateIssuesInput = {
  issues: { owner: string; repo: string; title: string; body?: string; labels?: string[] }[];
};

export async function execute(input: CreateIssuesInput, context: ConnectorNodeContext) {
  const results = await context.fan_out({
    items: input.issues,
    limits: context.app.rate_limits,
    call_one: async (draft) => {
      const created = await send_github_request<GithubIssueRecord>(context, {
        method: 'POST',
        path: `/repos/${encodeURIComponent(draft.owner)}/${encodeURIComponent(draft.repo)}/issues`,
        body: { title: draft.title, body: draft.body, labels: draft.labels },
        response_schema: definition.response_schema,
      });
      return to_github_issue_output(created);
    },
  });

  return {
    results: input.issues.map((draft, index) => {
      const outcome = find_item_outcome(results, index);
      return {
        index,
        owner: draft.owner,
        repo: draft.repo,
        ok: outcome.ok,
        issue: outcome.ok ? outcome.data : null,
        error: outcome.ok ? null : outcome.error,
      };
    }),
  };
}
