import { composio_zoho_recipe } from '@connectors/composio/recipes/composio_zoho';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const record_page_payload = {
  response: {
    data: [
      {
        id: '9000001',
        Name: 'Northwind Traders',
        Owner: { id: '3000001' },
        Modified_Time: '2026-09-28T11:45:00+00:00',
      },
    ],
  },
};

describe('composio_zoho_recipe', () => {
  it('reads a record page, identity, title and owner relation', () => {
    const record = composio_zoho_recipe.objects.record;
    if (!record) throw new Error('composio_zoho_recipe is missing record');
    const items = evaluate_value_expression(record.page.items, record_page_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(record.identity, scope)).toBe('9000001');
    expect(evaluate_value_expression(record.title, scope)).toBe('Northwind Traders');
    expect(evaluate_value_expression(record.relationships?.owned_by, scope)).toBe('3000001');
    expect(evaluate_value_expression(record.metadata?.modified_time, scope)).toBe(
      '2026-09-28T11:45:00+00:00',
    );
  });

  it('falls back to the record id when Name is missing', () => {
    const record = composio_zoho_recipe.objects.record;
    if (!record) throw new Error('composio_zoho_recipe is missing record');
    const scope = { item: { id: '9000002' } };
    expect(evaluate_value_expression(record.title, scope)).toBe('9000002');
  });
});
