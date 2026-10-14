import { lifecycle_columns, metadata } from '@coworker/core/db/schema/common';
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const listing_states = ['ready', 'built_with_you'] as const;

export const template_kinds = ['task', 'skill', 'role'] as const;
export type TemplateKind = (typeof template_kinds)[number];

// Postgres full-text search vector. Drizzle has no built-in tsvector type, and this
// column is database-generated, so the app never writes it.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/**
 * One publishable, installable definition — a skill (what the coworker knows), a
 * task (what it does, and when), or a role (a named set of both). The same row
 * backs the public marketplace on the marketing site and the in-app gallery.
 *
 * What used to look like three more kinds — prompt, routine, automation — is one
 * field on the payload, `starts_when[].start_mode`, because those three differed
 * only in when the same instruction begins. A skill is what has no start mode at
 * all.
 *
 * This is the MVP shape: the full design
 * splits this into publishers / template_versions / template_version_requirements /
 * template_installations. Every jsonb column below holds exactly the rows those
 * tables will hold, so each split is an UNNEST and never a reshape.
 */
export const templates = pgTable(
  'templates',
  {
    template_id: text('template_id').primaryKey(),
    template_slug: text('template_slug').notNull(),
    template_kind: text('template_kind', { enum: template_kinds }).notNull(),
    catalog_scope: text('catalog_scope').notNull().default('workspace'),
    workspace_id: text('workspace_id'),

    publisher_handle: text('publisher_handle').notNull(),
    publisher_kind: text('publisher_kind').notNull().default('user'),
    publisher_display_name: text('publisher_display_name').notNull(),
    publisher_avatar_url: text('publisher_avatar_url'),

    template_name: text('template_name').notNull(),
    summary_text: text('summary_text').notNull().default(''),
    readme_markdown: text('readme_markdown').notNull().default(''),
    model_facing_description: text('model_facing_description').notNull().default(''),
    cover_image_url: text('cover_image_url'),

    template_version: integer('template_version').notNull().default(1),
    payload: jsonb('payload').notNull(),
    payload_schema_version: integer('payload_schema_version').notNull().default(1),
    setup_input_schema: jsonb('setup_input_schema').notNull().default(sql`'{}'::jsonb`),
    requirements: jsonb('requirements').notNull().default(sql`'[]'::jsonb`),

    listing_status: text('listing_status').notNull().default('draft'),
    discovery_status: text('discovery_status').notNull().default('visible'),
    submitted_time: timestamp('submitted_time', { withTimezone: true }),
    published_time: timestamp('published_time', { withTimezone: true }),
    review_notes: text('review_notes'),
    price_kind: text('price_kind').notNull().default('free'),

    listing_state: text('listing_state', { enum: listing_states })
      .notNull()
      .default('built_with_you'),

    forked_from_template_id: text('forked_from_template_id'),

    category_slugs: jsonb('category_slugs').notNull().default(sql`'[]'::jsonb`),
    tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),

    facets: jsonb('facets').notNull().default(sql`'[]'::jsonb`),

    display_config: jsonb('display_config').notNull().default(sql`'{}'::jsonb`),
    search_document: tsvector('search_document').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(template_name, '') || ' ' || coalesce(summary_text, ''))`,
    ),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    // Scoped uniqueness. Partial because workspace_id is nullable and a plain
    // unique index would treat NULL workspace_ids as distinct.
    uniqueIndex('idx_templates_global_slug_unique')
      .on(table.template_slug)
      .where(sql`${table.catalog_scope} = 'global' AND ${table.workspace_id} IS NULL`),
    uniqueIndex('idx_templates_workspace_slug_unique')
      .on(table.workspace_id, table.template_slug)
      .where(sql`${table.catalog_scope} = 'workspace'`),
    index('idx_templates_public_feed')
      .on(table.published_time.desc())
      .where(
        sql`${table.catalog_scope} = 'global' AND ${table.listing_status} = 'published' AND ${table.discovery_status} = 'visible'`,
      ),
    index('idx_templates_kind_feed')
      .on(table.template_kind, table.published_time.desc())
      .where(sql`${table.listing_status} = 'published'`),
    index('idx_templates_publisher').on(
      table.publisher_handle,
      table.listing_status,
      table.published_time.desc(),
    ),
    index('idx_templates_catalog_visibility').on(
      table.catalog_scope,
      table.workspace_id,
      table.listing_status,
    ),
    index('idx_templates_review_queue')
      .on(table.submitted_time)
      .where(sql`${table.listing_status} = 'in_review'`),
    index('idx_templates_search').using('gin', table.search_document),
    index('idx_templates_requirements').using('gin', sql`${table.requirements} jsonb_path_ops`),
    index('idx_templates_categories').using('gin', sql`${table.category_slugs} jsonb_path_ops`),
    index('idx_templates_tags').using('gin', sql`${table.tags} jsonb_path_ops`),
    index('idx_templates_facets').using('gin', sql`${table.facets} jsonb_path_ops`),
    index('idx_templates_state')
      .on(table.listing_state, table.published_time.desc())
      .where(sql`${table.listing_status} = 'published'`),
  ],
);
