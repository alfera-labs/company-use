import { composio_jira_recipe } from '@connectors/composio/recipes/composio_jira';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const issue_page_payload = {
  response: {
    issues: [
      {
        id: '10042',
        key: 'ENG-42',
        browser_url: 'https://example.atlassian.net/browse/ENG-42',
        summary: 'Composio jira recipe crawl test',
        description: 'Prove the issue maps to assignee and reporter relations.',
        status: { id: '3', name: 'In Progress', category: 'indeterminate' },
        updated: '2026-09-29T08:00:00.000+0000',
        assignee: { account_id: 'acc_assignee_01', display_name: 'Ada' },
        reporter: { account_id: 'acc_reporter_01', display_name: 'Grace' },
      },
    ],
    next_page_token: null,
  },
};

describe('composio_jira_recipe', () => {
  it('maps an issue to identity, title and the assignee/reporter relations', () => {
    const issue = composio_jira_recipe.objects.issue;
    if (!issue) throw new Error('composio_jira_recipe is missing issue');
    const items = evaluate_value_expression(issue.page.items, issue_page_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(issue.identity, scope)).toBe('10042');
    expect(evaluate_value_expression(issue.title, scope)).toBe('Composio jira recipe crawl test');
    expect(evaluate_value_expression(issue.relationships?.assignee, scope)).toBe('acc_assignee_01');
    expect(evaluate_value_expression(issue.relationships?.reporter, scope)).toBe('acc_reporter_01');
    expect(evaluate_value_expression(issue.version_signal, scope)).toBe(
      '2026-09-29T08:00:00.000+0000',
    );
  });

  it('falls back from a missing summary to the issue key', () => {
    const issue = composio_jira_recipe.objects.issue;
    if (!issue) throw new Error('composio_jira_recipe is missing issue');
    const scope = { item: { id: '1', key: 'ENG-1' } };
    expect(evaluate_value_expression(issue.title, scope)).toBe('ENG-1');
  });
});
