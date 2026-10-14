import { composio_attio_recipe } from '@connectors/composio/recipes/composio_attio';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const record_page_payload = {
  response: {
    data: [
      {
        id: { record_id: 'rec_01' },
        values: { name: [{ value: 'Globex Industries' }] },
        created_at: '2026-02-01T00:00:00Z',
      },
    ],
  },
};

describe('composio_attio_recipe', () => {
  it('reads a record page and its identity and title', () => {
    const record = composio_attio_recipe.objects.record;
    if (!record) throw new Error('composio_attio_recipe is missing record');
    const items = evaluate_value_expression(record.page.items, record_page_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(record.identity, scope)).toBe('rec_01');
    expect(evaluate_value_expression(record.title, scope)).toBe('Globex Industries');
  });

  it('falls back to the record id when no name value exists', () => {
    const record = composio_attio_recipe.objects.record;
    if (!record) throw new Error('composio_attio_recipe is missing record');
    const scope = { item: { id: { record_id: 'rec_02' }, values: {} } };
    expect(evaluate_value_expression(record.title, scope)).toBe('rec_02');
  });
});
