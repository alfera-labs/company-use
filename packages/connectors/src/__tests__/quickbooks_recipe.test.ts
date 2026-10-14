import node_outputs from '@connectors/composio/fixtures/batch_c_node_outputs.json' with {
  type: 'json',
};
import { quickbooks_recipe } from '@connectors/composio/recipes/quickbooks_recipe';
import { evaluate_value_expression, is_plain_record } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const invoice = quickbooks_recipe.objects.invoice;
const response = node_outputs['quickbooks-query_invoices-1'];

function read_first_item(): Record<string, unknown> {
  if (!invoice) throw new Error('invoice object missing');
  const items = evaluate_value_expression(invoice.page.items, { response });
  const [item] = Array.isArray(items) ? items : [];
  if (!is_plain_record(item)) throw new Error('the page holds no item');
  return item;
}

describe('quickbooks_recipe', () => {
  it('reads the identity and title out of the quickbooks-query_invoices-1 output', () => {
    const scope = { item: read_first_item() };
    expect(evaluate_value_expression(invoice?.identity, scope)).toBe('Id-1');
    expect(evaluate_value_expression(invoice?.title, scope)).toBe('DocNumber-1');
  });

  it('falls back to the invoice Id when there is no DocNumber', () => {
    const scope = { item: { ...read_first_item(), DocNumber: null } };
    expect(evaluate_value_expression(invoice?.title, scope)).toBe('Id-1');
  });
});
