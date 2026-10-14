import node_outputs from '@connectors/composio/fixtures/batch_c_node_outputs.json' with {
  type: 'json',
};
import { mailchimp_recipe } from '@connectors/composio/recipes/mailchimp_recipe';
import { evaluate_value_expression, is_plain_record } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const campaign = mailchimp_recipe.objects.campaign;
const response = node_outputs['mailchimp-list_campaigns-1'];

function read_first_item(): Record<string, unknown> {
  if (!campaign) throw new Error('campaign object missing');
  const items = evaluate_value_expression(campaign.page.items, { response });
  const [item] = Array.isArray(items) ? items : [];
  if (!is_plain_record(item)) throw new Error('the page holds no item');
  return item;
}

describe('mailchimp_recipe', () => {
  it('reads the identity and title out of the mailchimp-list_campaigns-1 output', () => {
    const scope = { item: read_first_item() };
    expect(evaluate_value_expression(campaign?.identity, scope)).toBe('id-1');
    expect(evaluate_value_expression(campaign?.title, scope)).toBe('subjectLine-1');
    expect(evaluate_value_expression(campaign?.read_item?.input, scope)).toEqual({
      campaign_id: 'id-1',
    });
  });

  it('falls back to the campaign title when settings omit a subject line', () => {
    const scope = { item: { ...read_first_item(), settings: { title: 'title-1' } } };
    expect(evaluate_value_expression(campaign?.title, scope)).toBe('title-1');
  });
});
