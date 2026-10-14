import { composio_salesforce_recipe } from '@connectors/composio/recipes/composio_salesforce';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const account_payload = {
  response: {
    records: [
      {
        Id: '001A000001',
        Name: 'Acme Corp',
        Description: 'A long-time customer.',
        OwnerId: '005A000001',
        Industry: 'Manufacturing',
        Phone: '+1-555-0100',
        Website: 'https://acme.example.com',
      },
    ],
  },
};

const opportunity_payload = {
  response: {
    records: [
      {
        Id: '006A000001',
        Name: 'Acme renewal Q4',
        StageName: 'Negotiation',
        OwnerId: '005A000001',
        AccountId: '001A000001',
        Amount: 48000,
        CloseDate: '2026-12-15',
      },
    ],
  },
};

describe('composio_salesforce_recipe', () => {
  it('maps an account record to identity, title and owner relation', () => {
    const account = composio_salesforce_recipe.objects.account;
    if (!account) throw new Error('composio_salesforce_recipe is missing account');
    const items = evaluate_value_expression(account.page.items, account_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(account.identity, scope)).toBe('001A000001');
    expect(evaluate_value_expression(account.title, scope)).toBe('Acme Corp');
    expect(evaluate_value_expression(account.relationships?.owned_by, scope)).toBe('005A000001');
    expect(evaluate_value_expression(account.metadata?.industry, scope)).toBe('Manufacturing');
  });

  it('maps an opportunity record to its account relation and amount', () => {
    const opportunity = composio_salesforce_recipe.objects.opportunity;
    if (!opportunity) throw new Error('composio_salesforce_recipe is missing opportunity');
    const items = evaluate_value_expression(opportunity.page.items, opportunity_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(opportunity.identity, scope)).toBe('006A000001');
    expect(evaluate_value_expression(opportunity.title, scope)).toBe('Acme renewal Q4');
    expect(evaluate_value_expression(opportunity.relationships?.related_to, scope)).toBe(
      '001A000001',
    );
    expect(evaluate_value_expression(opportunity.metadata?.amount, scope)).toBe(48000);
  });
});
