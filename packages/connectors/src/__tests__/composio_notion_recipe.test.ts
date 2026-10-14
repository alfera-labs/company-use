import { composio_notion_recipe } from '@connectors/composio/recipes/composio_notion';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const database_row_page_payload = {
  response: {
    results: [
      {
        id: 'row_01',
        archived: false,
        url: 'https://notion.so/row_01',
        created_by: { id: 'user_01' },
        properties: { Name: { title: [{ plain_text: 'Q4 launch checklist' }] } },
      },
    ],
    next_cursor: null,
  },
};

const page_search_payload = {
  response: {
    results: [
      {
        id: 'page_01',
        archived: false,
        url: 'https://notion.so/page_01',
        created_by: { id: 'user_02' },
        properties: { title: { title: [{ plain_text: 'Quarterly plan' }] } },
      },
    ],
    next_cursor: null,
  },
};

describe('composio_notion_recipe', () => {
  it('reads a database row, its title and the archived tombstone', () => {
    const database_row = composio_notion_recipe.objects.database_row;
    if (!database_row) throw new Error('composio_notion_recipe is missing database_row');
    const items = evaluate_value_expression(database_row.page.items, database_row_page_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(database_row.identity, scope)).toBe('row_01');
    expect(evaluate_value_expression(database_row.title, scope)).toBe('Q4 launch checklist');
    expect(evaluate_value_expression(database_row.tombstone, scope)).toBe(false);
    expect(evaluate_value_expression(database_row.relationships?.author, scope)).toBe('user_01');
  });

  it('reads a searched page and its url', () => {
    const page = composio_notion_recipe.objects.page;
    if (!page) throw new Error('composio_notion_recipe is missing page');
    const items = evaluate_value_expression(page.page.items, page_search_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(page.identity, scope)).toBe('page_01');
    expect(evaluate_value_expression(page.title, scope)).toBe('Quarterly plan');
    expect(evaluate_value_expression(page.source_url, scope)).toBe('https://notion.so/page_01');
  });
});
