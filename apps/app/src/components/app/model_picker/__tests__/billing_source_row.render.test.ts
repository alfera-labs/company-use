import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BillingSourceRow } from '@/components/app/model_picker/billing_source_row';

describe('the footer of the model list in the open copy', () => {
  it('tells the person that they pay their model provider for each token', () => {
    const html = renderToStaticMarkup(createElement(BillingSourceRow));

    expect(html).toContain('>You pay your model provider for each token.</p>');
    expect(html).not.toContain('credits');
  });
});
