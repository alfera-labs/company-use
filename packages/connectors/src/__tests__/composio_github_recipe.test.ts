import { composio_github_recipe } from '@connectors/composio/recipes/composio_github';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const pull_request_page_payload = {
  response: {
    pull_requests: [
      {
        id: 991,
        number: 42,
        title: 'Fix the flaky retry test',
        body: 'Retries now back off with jitter.',
        state: 'open',
        updated_at: '2026-09-30T10:15:00Z',
        html_url: 'https://github.com/acme/widgets/pull/42',
        user: { login: 'ottopark' },
      },
    ],
    total_count: 1,
  },
};

const issue_page_payload = {
  response: {
    items: [
      {
        id: 772,
        number: 17,
        title: 'Composio sync stalls on rate limit',
        body: 'Repro with GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS.',
        state: 'open',
        html_url: 'https://github.com/acme/widgets/issues/17',
        repository_url: 'https://api.github.com/repos/acme/widgets',
        user: { login: 'founder-alfera' },
      },
    ],
    total_count: 1,
  },
};

describe('composio_github_recipe', () => {
  it('reads the pull request page, identity, title and author relation', () => {
    const pull_request = composio_github_recipe.objects.pull_request;
    if (!pull_request) throw new Error('composio_github_recipe is missing pull_request');
    const items = evaluate_value_expression(pull_request.page.items, pull_request_page_payload);
    expect(Array.isArray(items)).toBe(true);
    const item = (items as unknown[])[0];
    const scope = { item };
    expect(evaluate_value_expression(pull_request.identity, scope)).toBe(991);
    expect(evaluate_value_expression(pull_request.title, scope)).toBe('Fix the flaky retry test');
    expect(evaluate_value_expression(pull_request.content, scope)).toBe(
      'Retries now back off with jitter.',
    );
    expect(evaluate_value_expression(pull_request.relationships?.author, scope)).toBe('ottopark');
  });

  it('reads the author of an optimized pull request that names it author instead of user', () => {
    const pull_request = composio_github_recipe.objects.pull_request;
    if (!pull_request) throw new Error('composio_github_recipe is missing pull_request');
    const scope = { item: { id: 2, number: 10, author: { login: 'ottopark' } } };
    expect(evaluate_value_expression(pull_request.relationships?.author, scope)).toBe('ottopark');
  });

  it('falls back from a missing pull request title to the number', () => {
    const pull_request = composio_github_recipe.objects.pull_request;
    if (!pull_request) throw new Error('composio_github_recipe is missing pull_request');
    const scope = { item: { id: 1, number: 9 } };
    expect(evaluate_value_expression(pull_request.title, scope)).toBe(9);
  });

  it('reads the issue page and keeps the repository url in metadata', () => {
    const issue = composio_github_recipe.objects.issue;
    if (!issue) throw new Error('composio_github_recipe is missing issue');
    const items = evaluate_value_expression(issue.page.items, issue_page_payload);
    const item = (items as unknown[])[0];
    const scope = { item };
    expect(evaluate_value_expression(issue.identity, scope)).toBe(772);
    expect(evaluate_value_expression(issue.title, scope)).toBe(
      'Composio sync stalls on rate limit',
    );
    expect(evaluate_value_expression(issue.metadata?.repository_url, scope)).toBe(
      'https://api.github.com/repos/acme/widgets',
    );
    expect(evaluate_value_expression(issue.relationships?.author, scope)).toBe('founder-alfera');
  });
});
