import node_outputs from '@connectors/composio/fixtures/batch_c_node_outputs.json' with {
  type: 'json',
};
import { canva_recipe } from '@connectors/composio/recipes/canva_recipe';
import { evaluate_value_expression, is_plain_record } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const design = canva_recipe.objects.design;
const response = node_outputs['canva-list_user_designs-1'];

function read_first_item(): Record<string, unknown> {
  if (!design) throw new Error('design object missing');
  const items = evaluate_value_expression(design.page.items, { response });
  const [item] = Array.isArray(items) ? items : [];
  if (!is_plain_record(item)) throw new Error('the page holds no item');
  return item;
}

describe('canva_recipe', () => {
  it('reads the identity and title out of the canva-list_user_designs-1 output', () => {
    const scope = { item: read_first_item() };
    expect(evaluate_value_expression(design?.identity, scope)).toBe('id-1');
    expect(evaluate_value_expression(design?.title, scope)).toBe('title-1');
  });

  it('falls back to the design id when there is no title', () => {
    const scope = { item: { ...read_first_item(), title: null } };
    expect(evaluate_value_expression(design?.title, scope)).toBe('id-1');
  });
});
