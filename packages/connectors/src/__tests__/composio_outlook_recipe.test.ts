import { composio_outlook_recipe } from '@connectors/composio/recipes/composio_outlook';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const message_page_payload = {
  response: {
    value: [
      {
        id: 'msg_900',
        subject: 'Invoice attached',
        bodyPreview: 'Please find the invoice attached.',
        body: { contentType: 'html', content: '<p>Please find the invoice attached.</p>' },
        receivedDateTime: '2026-09-21T09:30:00Z',
        from: { emailAddress: { address: 'billing@vendor.example.com' } },
      },
    ],
  },
};

describe('composio_outlook_recipe', () => {
  it('maps a message to identity, title, body content and author relation', () => {
    const message = composio_outlook_recipe.objects.message;
    if (!message) throw new Error('composio_outlook_recipe is missing message');
    const items = evaluate_value_expression(message.page.items, message_page_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(message.identity, scope)).toBe('msg_900');
    expect(evaluate_value_expression(message.title, scope)).toBe('Invoice attached');
    expect(evaluate_value_expression(message.relationships?.author, scope)).toBe(
      'billing@vendor.example.com',
    );
    expect(evaluate_value_expression(message.content, scope)).toBe(
      '<p>Please find the invoice attached.</p>',
    );
  });

  it('falls back to the body preview when the full body is missing', () => {
    const message = composio_outlook_recipe.objects.message;
    if (!message) throw new Error('composio_outlook_recipe is missing message');
    const scope = {
      item: { id: 'msg_901', subject: 'Preview only', bodyPreview: 'Short preview' },
    };
    expect(evaluate_value_expression(message.content, scope)).toBe('Short preview');
  });
});
