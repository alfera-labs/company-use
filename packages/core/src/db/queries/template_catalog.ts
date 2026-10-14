import type { Database } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { templates } from '@coworker/core/db/schema';
import type { TemplateKind } from '@coworker/core/db/schema/templates';
import { create_id, id_prefixes, type TemplateListingState } from '@coworker/shared';
import { and, asc, count, desc, eq, isNull, or, type SQL, sql } from 'drizzle-orm';

/**
 * Reads and writes for the catalog itself — the `templates` rows that back both the public
 * marketplace and the in-app gallery. Product behaviour (publishing a folder, installing a
 * listing) lives in packages/core/src/templates; this file only moves rows.
 */

export type TemplateRow = typeof templates.$inferSelect;

export type PublishTemplateInput = {
  template_slug: string;
  template_kind: TemplateKind;
  template_name: string;
  summary_text: string;
  readme_markdown: string;
  model_facing_description: string;
  payload: Record<string, unknown>;
  setup_input_schema: Record<string, unknown>;
  requirements: unknown[];
  facets: unknown[];
  category_slugs: string[];
  tags: string[];
  display_config: Record<string, unknown>;
  listing_state: TemplateListingState;
  publisher_handle: string;
  publisher_kind: string;
  publisher_display_name: string;
  metadata: Record<string, unknown>;
  actor_id: string;
};

/**
 * Publishes into the global catalog, keyed on the slug.
 *
 * Re-publishing the same slug bumps `template_version`, which is what breaks the install-time
 * authority hash and forces a human to re-read and re-grant. It is never a silent in-place edit.
 */
export async function publish_global_template(db: Database, input: PublishTemplateInput) {
  const existing = await get_global_template_by_slug(db, input.template_slug);
  const now = new Date();
  const values = {
    template_slug: input.template_slug,
    template_kind: input.template_kind,
    catalog_scope: 'global' as const,
    workspace_id: null,
    publisher_handle: input.publisher_handle,
    publisher_kind: input.publisher_kind,
    publisher_display_name: input.publisher_display_name,
    template_name: input.template_name,
    summary_text: input.summary_text,
    readme_markdown: input.readme_markdown,
    model_facing_description: input.model_facing_description,
    payload: input.payload,
    setup_input_schema: input.setup_input_schema,
    requirements: input.requirements,
    facets: input.facets,
    category_slugs: input.category_slugs,
    tags: input.tags,
    display_config: input.display_config,
    listing_state: input.listing_state,
    listing_status: 'published' as const,
    discovery_status: 'visible' as const,
    published_time: existing?.published_time ?? now,
    metadata: input.metadata,
    last_updated_time: now,
    last_updated_by: input.actor_id,
  };

  if (!existing) {
    const [inserted] = await db
      .insert(templates)
      .values({
        ...values,
        template_id: create_id(id_prefixes.template),
        template_version: 1,
        created_by: input.actor_id,
      })
      .returning();
    return require_inserted_row(inserted, 'Template');
  }

  const [updated] = await db
    .update(templates)
    .set({ ...values, template_version: existing.template_version + 1 })
    .where(eq(templates.template_id, existing.template_id))
    .returning();
  return require_inserted_row(updated, 'Template');
}

export async function get_global_template_by_slug(db: Database, template_slug: string) {
  return (
    (await db.query.templates.findFirst({
      where: and(
        eq(templates.template_slug, template_slug),
        eq(templates.catalog_scope, 'global'),
        isNull(templates.workspace_id),
      ),
    })) ?? null
  );
}

/** The three orders the catalogue toolbar offers. */
export const template_sort_orders = ['recommended', 'newest', 'name'] as const;
export type TemplateSortOrder = (typeof template_sort_orders)[number];

export type TemplateSearchInput = {
  query?: string | undefined;
  facet_key?: string | undefined;
  template_kind?: TemplateKind | undefined;
  listing_state?: TemplateListingState | undefined;
  sort_order?: TemplateSortOrder | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

const default_search_limit = 60;

function build_search_order(sort_order: TemplateSortOrder | undefined) {
  if (sort_order === 'newest')
    return [desc(templates.published_time), asc(templates.template_name)];
  if (sort_order === 'name') return [asc(templates.template_name)];
  return [
    desc(templates.listing_state),
    sql`CASE ${templates.template_kind} WHEN 'task' THEN 0 ELSE 1 END`,
    asc(templates.template_name),
  ];
}

export async function search_published_templates(db: Database, input: TemplateSearchInput = {}) {
  const where = build_search_where(input);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(templates)
      .where(where)
      .orderBy(...build_search_order(input.sort_order))
      .limit(input.limit ?? default_search_limit)
      .offset(input.offset ?? 0),
    db.select({ total: count() }).from(templates).where(where),
  ]);
  return { listings: rows, total_count: Number(total?.total ?? 0) };
}

function build_search_where(input: TemplateSearchInput) {
  const conditions: SQL[] = [
    eq(templates.catalog_scope, 'global'),
    eq(templates.listing_status, 'published'),
    eq(templates.discovery_status, 'visible'),
  ];
  if (input.template_kind) conditions.push(eq(templates.template_kind, input.template_kind));
  if (input.listing_state) conditions.push(eq(templates.listing_state, input.listing_state));
  if (input.facet_key) {
    conditions.push(
      sql`${templates.facets} @> ${JSON.stringify([{ facet_key: input.facet_key }])}::jsonb`,
    );
  }
  const text = input.query?.trim();
  if (text) {
    const like = `%${text.toLowerCase()}%`;
    conditions.push(
      or(
        sql`lower(${templates.template_name}) LIKE ${like}`,
        sql`lower(${templates.summary_text}) LIKE ${like}`,
        sql`lower(${templates.template_slug}) LIKE ${like}`,
      ) as SQL,
    );
  }
  return and(...conditions) as SQL;
}

/**
 * The apps the catalogue touches, with how many listings touch each.
 *
 * The label comes out of the requirement rows rather than a registry in code, so an app the shelf
 * has never heard of still prints with the name its author gave it.
 */
export async function count_published_templates_by_app(db: Database) {
  const rows = await db
    .select({
      app_key: sql<string>`requirement->>'requirement_key'`,
      label: sql<string>`max(requirement->>'requirement_label')`,
      listing_count: count(),
    })
    .from(sql`${templates}, jsonb_array_elements(${templates.requirements}) AS requirement`)
    .where(
      and(
        eq(templates.catalog_scope, 'global'),
        eq(templates.listing_status, 'published'),
        eq(templates.discovery_status, 'visible'),
        sql`requirement->>'requirement_kind' = 'app_connection'`,
      ),
    )
    .groupBy(sql`requirement->>'requirement_key'`)
    .orderBy(desc(count()), sql`requirement->>'requirement_key'`);
  return rows.map((row) => ({ ...row, listing_count: Number(row.listing_count) }));
}

/** How many published listings sit on each facet_key, for the category counts. */
export async function count_published_templates_by_facet(db: Database) {
  const rows = await db
    .select({
      facet_key: sql<string>`facet->>'facet_key'`,
      facet_kind: sql<string>`facet->>'facet_kind'`,
      listing_count: count(),
    })
    .from(sql`${templates}, jsonb_array_elements(${templates.facets}) AS facet`)
    .where(
      and(
        eq(templates.catalog_scope, 'global'),
        eq(templates.listing_status, 'published'),
        eq(templates.discovery_status, 'visible'),
      ),
    )
    .groupBy(sql`facet->>'facet_key'`, sql`facet->>'facet_kind'`);
  return rows.map((row) => ({ ...row, listing_count: Number(row.listing_count) }));
}
