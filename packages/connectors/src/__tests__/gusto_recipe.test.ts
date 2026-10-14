import node_outputs from '@connectors/composio/fixtures/batch_c_node_outputs.json' with {
  type: 'json',
};
import { gusto_recipe } from '@connectors/composio/recipes/gusto_recipe';
import { evaluate_value_expression, is_plain_record } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const employee = gusto_recipe.objects.employee;
const response = node_outputs['gusto-list_employees-1'];

function read_first_item(): Record<string, unknown> {
  if (!employee) throw new Error('employee object missing');
  const items = evaluate_value_expression(employee.page.items, { response });
  const [item] = Array.isArray(items) ? items : [];
  if (!is_plain_record(item)) throw new Error('the page holds no item');
  return item;
}

describe('gusto_recipe', () => {
  it('reads the identity and title out of the gusto-list_employees-1 output', () => {
    const scope = { item: read_first_item() };
    expect(evaluate_value_expression(employee?.identity, scope)).toBe('uuid-1');
    expect(evaluate_value_expression(employee?.title, scope)).toBe(
      'preferred_first_name-1 last_name-1',
    );
    expect(JSON.stringify(evaluate_value_expression(employee?.content, scope))).not.toContain(
      'ssn-1',
    );
  });

  it('joins the legal first name when there is no preferred first name', () => {
    const scope = { item: { ...read_first_item(), preferred_first_name: null } };
    expect(evaluate_value_expression(employee?.title, scope)).toBe('first_name-1 last_name-1');
  });

  it('falls back to the work email, then the personal email, when there is no name', () => {
    const nameless = {
      ...read_first_item(),
      preferred_first_name: null,
      first_name: '',
      last_name: null,
    };
    expect(evaluate_value_expression(employee?.title, { item: nameless })).toBe('work_email-1');
    const scope = { item: { ...nameless, work_email: null } };
    expect(evaluate_value_expression(employee?.title, scope)).toBe('email-1');
  });
});
