import type { Database } from '@coworker/core/db/connection';
import {
  count_published_templates_by_app,
  count_published_templates_by_facet,
  get_global_template_by_slug,
  search_published_templates,
  type TemplateRow,
  type TemplateSortOrder,
} from '@coworker/core/db/queries/template_catalog';
import {
  describe_catalog_heading,
  template_categories,
} from '@coworker/core/templates/catalog_categories';
import {
  anonymous_viewer,
  build_template_card_or_skip,
  build_template_listing,
  type CatalogViewer,
} from '@coworker/core/templates/catalog_view_model';
import { template_facets_schema } from '@coworker/core/templates/template_object';
import type { TemplateCard, TemplateCatalog, TemplateFilterOption } from '@coworker/shared';
import { NotFoundError } from '@coworker/shared';

function to_cards(rows: TemplateRow[], viewer: CatalogViewer): TemplateCard[] {
  return rows
    .map((row) => build_template_card_or_skip(row, viewer))
    .filter((card): card is TemplateCard => card !== null);
}

export async function read_catalog_viewer(
  db: Database,
  input: { workspace_id?: string | undefined; connected_app_keys?: string[] | undefined },
): Promise<CatalogViewer> {
  if (!input.workspace_id) return anonymous_viewer;
  return {
    connected_app_keys: new Set(input.connected_app_keys ?? []),
    installed_template_ids: new Set<string>(),
  };
}

export type CatalogQuery = {
  facet_kind?: 'category' | 'role' | 'app' | 'topic' | null;
  facet_key?: string | null;
  query?: string | undefined;
  template_kind?: 'task' | 'skill' | undefined;
  sort_order?: TemplateSortOrder | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  viewer?: CatalogViewer | undefined;
};

const kind_tabs: { key: string; label: string; template_kind?: 'task' | 'skill' }[] = [
  { key: 'all', label: 'All' },
  { key: 'task', label: 'Tasks', template_kind: 'task' },
  { key: 'skill', label: 'Skills', template_kind: 'skill' },
];

const sort_tabs: { key: TemplateSortOrder; label: string }[] = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'newest', label: 'Newest' },
  { key: 'name', label: 'A–Z' },
];

export async function build_template_catalog(
  db: Database,
  input: CatalogQuery = {},
): Promise<TemplateCatalog> {
  const viewer = input.viewer ?? anonymous_viewer;
  const [filtered, everything, facet_counts, app_counts] = await Promise.all([
    search_published_templates(db, {
      facet_key: input.facet_key ?? undefined,
      query: input.query,
      template_kind: input.template_kind,
      sort_order: input.sort_order,
      limit: input.limit,
      offset: input.offset,
    }),
    search_published_templates(db, { limit: 1 }),
    count_published_templates_by_facet(db),
    count_published_templates_by_app(db),
  ]);

  const counts_by_key = new Map(facet_counts.map((row) => [row.facet_key, row.listing_count]));
  const active_kind = input.template_kind ?? 'all';
  const active_sort = input.sort_order ?? 'recommended';

  return {
    total_count: everything.total_count,
    filtered_count: filtered.total_count,
    installed_count: viewer.installed_template_ids.size,
    heading: describe_catalog_heading({
      facet_kind: input.facet_kind ?? null,
      facet_key: input.facet_key ?? null,
      query: input.query ?? null,
    }),
    query: input.query?.trim() || null,
    kinds: kind_tabs.map((tab) => ({
      key: tab.key,
      label: tab.label,
      listing_count: null,
      is_active: tab.key === active_kind,
    })),
    categories: template_categories.map((category) => ({
      key: category.facet_key,
      label: category.title,
      listing_count: counts_by_key.get(category.facet_key) ?? 0,
      is_active: input.facet_kind === 'category' && input.facet_key === category.facet_key,
    })),
    apps: app_counts.map(
      (app): TemplateFilterOption => ({
        key: app.app_key,
        label: app.label || app.app_key,
        listing_count: app.listing_count,
        is_active: input.facet_kind === 'app' && input.facet_key === app.app_key,
      }),
    ),
    sorts: sort_tabs.map((tab) => ({
      key: tab.key,
      label: tab.label,
      listing_count: null,
      is_active: tab.key === active_sort,
    })),
    listings: to_cards(filtered.listings, viewer),
  };
}

export async function build_template_listing_by_slug(
  db: Database,
  input: { template_slug: string; viewer?: CatalogViewer | undefined },
) {
  const template = await get_global_template_by_slug(db, input.template_slug);
  if (!template || template.listing_status !== 'published') {
    throw new NotFoundError(`No listing named "${input.template_slug}".`);
  }
  return build_template_listing(template, {
    viewer: input.viewer ?? anonymous_viewer,
    related: await read_related_listings(db, template),
  });
}

async function read_related_listings(db: Database, template: TemplateRow) {
  const facets = template_facets_schema.parse(template.facets);
  const primary = facets.find((facet) => facet.is_primary) ?? facets[0];
  if (!primary) return [];
  const { listings } = await search_published_templates(db, {
    facet_key: primary.facet_key,
    limit: 4,
  });
  return listings.filter((row) => row.template_id !== template.template_id).slice(0, 3);
}
