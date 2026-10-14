import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomeTaskGallery } from '@/components/app/home_task_gallery';
import { home_templates } from '@/lib/home_template_catalog';

describe('HomeTaskGallery', () => {
  const first_sales_template = home_templates.find((template) => template.category === 'sales');
  if (!first_sales_template) throw new Error('Expected at least one sales template.');

  it('renders template names and pitches, never the setup message body', () => {
    const html = renderToStaticMarkup(
      createElement(HomeTaskGallery, { apps: [], onSelectTemplate: vi.fn() }),
    );

    expect(html).toContain(first_sales_template.name);
    expect(html).not.toContain('Set up this task for me');
    expect(html).toContain(`Browse all ${home_templates.length} templates`);
  });

  it('keeps the events vertical off the home shelf', () => {
    const html = renderToStaticMarkup(
      createElement(HomeTaskGallery, { apps: [], onSelectTemplate: vi.fn() }),
    );

    for (const template of home_templates.filter((entry) => entry.category === 'events')) {
      expect(html).not.toContain(template.name);
    }
  });

  it('every template carries a setup message that opens with the ask', () => {
    for (const template of home_templates) {
      expect(template.setup_message.length).toBeGreaterThan(100);
      expect(template.setup_message).toContain(`Template: ${template.name}`);
    }
  });
});
