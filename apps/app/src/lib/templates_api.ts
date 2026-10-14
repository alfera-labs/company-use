import type { TemplateCatalog, TemplateListing } from '@coworker/shared';
import { get_onboarding_snapshot_on_server, server_api_fetch } from '@/lib/server_api';
import { keep_listings_that_need_no_app } from '@/lib/templates_that_need_no_app';

async function read_templates<T>(path: string): Promise<T | null> {
  try {
    const response = await server_api_fetch(path);
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: T };
    return body.data ?? null;
  } catch {
    return null;
  }
}

export async function read_template_catalog(input: {
  facet_kind?: 'category' | 'role' | 'app' | null;
  facet_key?: string | null;
  query?: string | undefined;
  kind?: string | undefined;
  sort?: string | undefined;
}) {
  const params = new URLSearchParams();
  if (input.facet_kind && input.facet_key) {
    params.set('facet_kind', input.facet_kind);
    params.set('facet_key', input.facet_key);
  }
  if (input.query) params.set('q', input.query);
  if (input.kind) params.set('kind', input.kind);
  if (input.sort) params.set('sort', input.sort);
  const query = params.toString();
  const [catalog, snapshot] = await Promise.all([
    read_templates<TemplateCatalog>(`/v1/templates${query ? `?${query}` : ''}`),
    get_onboarding_snapshot_on_server(),
  ]);
  const has_app_catalogue = snapshot?.install.app_provider_configured ?? true;
  return catalog && !has_app_catalogue ? keep_listings_that_need_no_app(catalog) : catalog;
}

export function read_template_listing(slug: string) {
  return read_templates<TemplateListing>(`/v1/templates/${encodeURIComponent(slug)}`);
}
