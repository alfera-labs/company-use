import { composio_asana_recipe } from '@connectors/composio/recipes/composio_asana';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const task_page_payload = {
  response: {
    data: [
      {
        gid: '1200111',
        name: 'Ship the Composio recipes',
        created_by: { gid: '900222', resource_type: 'user' },
        resource_type: 'task',
        resource_subtype: 'default_task',
      },
    ],
    next_page: null,
  },
};

describe('composio_asana_recipe', () => {
  it('maps a task to identity, title and the author relation', () => {
    const task = composio_asana_recipe.objects.task;
    if (!task) throw new Error('composio_asana_recipe is missing task');
    const items = evaluate_value_expression(task.page.items, task_page_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(task.identity, scope)).toBe('1200111');
    expect(evaluate_value_expression(task.title, scope)).toBe('Ship the Composio recipes');
    expect(evaluate_value_expression(task.relationships?.author, scope)).toBe('900222');
    expect(evaluate_value_expression(task.metadata?.subtype, scope)).toBe('default_task');
  });

  it('falls back to the task gid when the name is missing', () => {
    const task = composio_asana_recipe.objects.task;
    if (!task) throw new Error('composio_asana_recipe is missing task');
    const scope = { item: { gid: '1200112' } };
    expect(evaluate_value_expression(task.title, scope)).toBe('1200112');
  });
});
