import { describe, expect, it } from 'vitest';
import { alfera_cloud_page } from '@/lib/alfera_cloud_page';
import { app_page_definitions } from '@/lib/app_navigation';
import { find_settings_section } from '@/lib/settings_navigation';

describe('app navigation in this edition', () => {
  it('lists no usage, billing or get-started page', () => {
    const paths = app_page_definitions.map((page) => page.path);

    expect(paths).not.toContain('/usage');
    expect(paths).not.toContain('/get-started');
  });

  it('lists no page whose only content is a link to the hosted product', () => {
    const titles = app_page_definitions.map((page) => page.title);

    expect(titles).not.toContain('Memory');
    expect(titles).toContain('Automations');
    expect(titles).not.toContain('Scheduled tasks');
  });

  it('sends the paths of the hosted pages to the one Settings page that names them', () => {
    const section = find_settings_section(alfera_cloud_page.params.section);

    expect(alfera_cloud_page.to).toBe('/settings/{-$section}');
    expect(section.title).toBe('Alfera Cloud');
  });
});
