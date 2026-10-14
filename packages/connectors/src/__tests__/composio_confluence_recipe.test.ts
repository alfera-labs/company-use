import { composio_confluence_recipe } from '@connectors/composio/recipes/composio_confluence';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const page_page_payload = {
  response: {
    results: [
      {
        id: 'page_900',
        title: 'Runbook: incident response',
        authorId: 'confluence_user_01',
        body: { storage: { value: '<p>Call the on-call engineer.</p>' } },
        version: { number: 7 },
      },
    ],
    _links: { next: null },
  },
};

describe('composio_confluence_recipe', () => {
  it('maps a page to identity, title, body and author relation', () => {
    const page = composio_confluence_recipe.objects.page;
    if (!page) throw new Error('composio_confluence_recipe is missing page');
    const items = evaluate_value_expression(page.page.items, page_page_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(page.identity, scope)).toBe('page_900');
    expect(evaluate_value_expression(page.title, scope)).toBe('Runbook: incident response');
    expect(evaluate_value_expression(page.content, scope)).toBe(
      '<p>Call the on-call engineer.</p>',
    );
    expect(evaluate_value_expression(page.relationships?.author, scope)).toBe('confluence_user_01');
    expect(evaluate_value_expression(page.metadata?.version, scope)).toBe(7);
  });
});
