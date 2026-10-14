import { composio_hubspot_recipe } from '@connectors/composio/recipes/composio_hubspot';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const record_page_payload = {
  response: {
    results: [
      {
        id: '501',
        properties: {
          name: 'Jane Doe',
          description: 'VP of Engineering',
          hubspot_owner_id: '12345',
        },
        createdAt: '2026-01-10T09:00:00Z',
        updatedAt: '2026-09-20T14:30:00Z',
      },
    ],
    paging: { next: { after: 'cursor_2' } },
  },
};

describe('composio_hubspot_recipe', () => {
  it('reads a record page, the next cursor and the owner relation', () => {
    const record = composio_hubspot_recipe.objects.record;
    if (!record) throw new Error('composio_hubspot_recipe is missing record');
    const items = evaluate_value_expression(record.page.items, record_page_payload);
    const next_cursor = evaluate_value_expression(record.page.next_cursor, record_page_payload);
    expect(next_cursor).toBe('cursor_2');
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(record.identity, scope)).toBe('501');
    expect(evaluate_value_expression(record.title, scope)).toBe('Jane Doe');
    expect(evaluate_value_expression(record.content, scope)).toBe('VP of Engineering');
    expect(evaluate_value_expression(record.relationships?.owned_by, scope)).toBe('12345');
  });

  it('falls back to the record id when the name property is missing', () => {
    const record = composio_hubspot_recipe.objects.record;
    if (!record) throw new Error('composio_hubspot_recipe is missing record');
    const scope = { item: { id: '777', properties: {} } };
    expect(evaluate_value_expression(record.title, scope)).toBe('777');
  });
});
