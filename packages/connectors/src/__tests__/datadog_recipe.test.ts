import node_outputs from '@connectors/composio/fixtures/batch_c_node_outputs.json' with {
  type: 'json',
};
import { datadog_recipe } from '@connectors/composio/recipes/datadog_recipe';
import { evaluate_value_expression, is_plain_record } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const monitor = datadog_recipe.objects.monitor;
const response = node_outputs['datadog-list_monitors-1'];

function read_first_item(): Record<string, unknown> {
  if (!monitor) throw new Error('monitor object missing');
  const items = evaluate_value_expression(monitor.page.items, { response });
  const [item] = Array.isArray(items) ? items : [];
  if (!is_plain_record(item)) throw new Error('the page holds no item');
  return item;
}

describe('datadog_recipe', () => {
  it('reads the identity and title out of the datadog-list_monitors-1 output', () => {
    const scope = { item: read_first_item() };
    expect(evaluate_value_expression(monitor?.identity, scope)).toBe(1);
    expect(evaluate_value_expression(monitor?.title, scope)).toBe('name-1');
  });

  it('falls back to the monitor id when there is no name', () => {
    const scope = { item: { ...read_first_item(), name: null } };
    expect(evaluate_value_expression(monitor?.title, scope)).toBe(1);
  });
});
