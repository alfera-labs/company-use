import node_outputs from '@connectors/composio/fixtures/batch_c_node_outputs.json' with {
  type: 'json',
};
import { netsuite_recipe } from '@connectors/composio/recipes/netsuite_recipe';
import { evaluate_value_expression, is_plain_record } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const transaction = netsuite_recipe.objects.transaction;
const suiteql_answer = node_outputs['netsuite-run_suiteql_query-1'];
const response = {
  ...suiteql_answer,
  items: suiteql_answer.items.map((row) => ({ ...row, id: '101', tranid: 'INV-101' })),
};

function read_first_item(): Record<string, unknown> {
  if (!transaction) throw new Error('transaction object missing');
  const items = evaluate_value_expression(transaction.page.items, { response });
  const [item] = Array.isArray(items) ? items : [];
  if (!is_plain_record(item)) throw new Error('the page holds no item');
  return item;
}

describe('netsuite_recipe', () => {
  it('reads the identity and title out of the netsuite-run_suiteql_query-1 output', () => {
    const scope = { item: read_first_item() };
    expect(evaluate_value_expression(transaction?.identity, scope)).toBe('101');
    expect(evaluate_value_expression(transaction?.title, scope)).toBe('INV-101');
  });

  it('falls back to the internal id when there is no tranid', () => {
    const scope = { item: { ...read_first_item(), tranid: null } };
    expect(evaluate_value_expression(transaction?.title, scope)).toBe('101');
  });
});
