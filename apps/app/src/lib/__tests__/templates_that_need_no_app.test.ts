import type { TemplateCard, TemplateCatalog } from '@coworker/shared';
import { expect, it } from 'vitest';
import { keep_listings_that_need_no_app } from '@/lib/templates_that_need_no_app';

function listing(slug: string, app_keys: string[]): TemplateCard {
  return {
    kind: 'task',
    slug,
    name: slug,
    summary: 'A template.',
    listing_state: 'ready',
    category: null,
    when_line: 'On request',
    apps: app_keys.map((app_key) => ({
      app_key,
      label: app_key,
      is_optional: false,
      is_connected: false,
    })),
    publisher: { display_name: 'Zq Test', is_platform: true },
    is_installed: false,
  };
}

const catalog: TemplateCatalog = {
  total_count: 3,
  filtered_count: 3,
  installed_count: 0,
  heading: 'All templates',
  query: null,
  kinds: [],
  categories: [],
  apps: [{ key: 'hubspot', label: 'HubSpot', listing_count: 2, is_active: false }],
  sorts: [],
  listings: [
    listing('needs-hubspot', ['hubspot']),
    listing('our-escalation-rules', []),
    listing('needs-two-apps', ['hubspot', 'slack']),
  ],
};

it('keeps only the templates an install with no app catalogue key can use', () => {
  const usable = keep_listings_that_need_no_app(catalog);

  expect(usable.listings.map((entry) => entry.slug)).toEqual(['our-escalation-rules']);
  expect(usable.filtered_count).toBe(1);
  expect(usable.total_count).toBe(1);
  expect(usable.apps).toEqual([]);
  expect(usable.heading).toBe('All templates');
});
