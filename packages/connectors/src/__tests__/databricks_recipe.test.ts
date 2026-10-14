import node_outputs from '@connectors/composio/fixtures/batch_c_node_outputs.json' with {
  type: 'json',
};
import { databricks_recipe } from '@connectors/composio/recipes/databricks_recipe';
import { evaluate_value_expression, is_plain_record } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const job = databricks_recipe.objects.job;
const response = node_outputs['databricks-list_jobs-1'];

function read_first_item(): Record<string, unknown> {
  if (!job) throw new Error('job object missing');
  const items = evaluate_value_expression(job.page.items, { response });
  const [item] = Array.isArray(items) ? items : [];
  if (!is_plain_record(item)) throw new Error('the page holds no item');
  return item;
}

describe('databricks_recipe', () => {
  it('reads the identity and title out of the databricks-list_jobs-1 output', () => {
    const scope = { item: read_first_item() };
    expect(evaluate_value_expression(job?.identity, scope)).toBe(1);
    expect(evaluate_value_expression(job?.title, scope)).toBe('name-1');
  });

  it('falls back to the job id when settings have no name', () => {
    const scope = { item: { ...read_first_item(), settings: {} } };
    expect(evaluate_value_expression(job?.title, scope)).toBe(1);
  });
});
