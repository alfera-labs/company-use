import { sentry_recipe } from '@connectors/composio/recipes/sentry_recipe';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const issue_page_payload = {
  response: [
    {
      id: 'issue_1',
      title: 'TypeError: cannot read property of undefined',
      culprit: 'app/worker.ts',
      level: 'error',
      count: '42',
      status: 'unresolved',
      permalink: 'https://sentry.io/organizations/alfera/issues/issue_1',
      lastSeen: '2026-09-30T06:00:00Z',
    },
  ],
};

describe('sentry_recipe', () => {
  it('reads the issue page and identity', () => {
    const issue = sentry_recipe.objects.issue;
    if (!issue) throw new Error('issue object missing');
    const items = evaluate_value_expression(issue.page.items, issue_page_payload);
    const item = (items as unknown[])[0];
    const scope = { item };
    expect(evaluate_value_expression(issue.identity, scope)).toBe('issue_1');
    expect(evaluate_value_expression(issue.title, scope)).toBe(
      'TypeError: cannot read property of undefined',
    );
    expect(evaluate_value_expression(issue.version_signal, scope)).toBe('2026-09-30T06:00:00Z');
  });

  it('falls back to the short id when the title is missing', () => {
    const issue = sentry_recipe.objects.issue;
    if (!issue) throw new Error('issue object missing');
    const scope = { item: { id: 'issue_2', shortId: 'WEB-2' } };
    expect(evaluate_value_expression(issue.title, scope)).toBe('WEB-2');
  });
});
