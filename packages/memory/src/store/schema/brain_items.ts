import { lifecycle_columns, metadata, tsvector } from '@coworker/memory/store/schema/column_types';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const brain_items = pgTable(
  'brain_items',
  {
    brain_item_id: text('brain_item_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    brain_source_id: text('brain_source_id').notNull(),
    app_key: text('app_key').notNull(),
    external_item_id: text('external_item_id').notNull(),
    external_container_id: text('external_container_id'),
    container_path: text('container_path'),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    item_kind: text('item_kind').notNull().default('document'),
    source_url: text('source_url'),
    current_revision_id: text('current_revision_id'),
    deleted_time: timestamp('deleted_time', { withTimezone: true }),
    last_seen_sweep_id: text('last_seen_sweep_id'),
    item_tsv: tsvector('item_tsv'),
    scope_key: text('scope_key').notNull().default('workspace'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    check(
      'brain_items_scope_key_check',
      sql`length(${table.scope_key}) <= 420 AND ${table.scope_key} ~ '^[a-z][a-z_]{1,30}(:[A-Za-z0-9._-]+){0,3}$' AND ${table.scope_key} !~ '[^:]{129}'`,
    ),
    uniqueIndex('idx_brain_items_provider_identity').on(
      table.workspace_id,
      table.app_key,
      table.external_item_id,
    ),
    uniqueIndex('idx_brain_items_scope_slug').on(table.workspace_id, table.scope_key, table.slug),
    uniqueIndex('idx_brain_items_scope_kind_slug')
      .on(table.workspace_id, table.slug)
      .where(sql`${table.item_kind} = 'scope'`),
    uniqueIndex('idx_brain_items_scope_file_path')
      .on(table.workspace_id, table.scope_key, sql`(${table.metadata}->>'file_path')`)
      .where(sql`${table.metadata} ? 'file_path' AND ${table.deleted_time} IS NULL`),
    index('idx_brain_items_stale')
      .on(table.workspace_id)
      .where(sql`${table.metadata} ? 'stale_since'`),
    index('idx_brain_items_pending_file_revision')
      .on(table.workspace_id)
      .where(sql`${table.metadata} ? 'pending_file_revision_id'`),
    index('idx_brain_items_previous_slugs_metadata').using(
      'gin',
      sql`(${table.metadata}->'previous_slugs')`,
    ),
    index('idx_brain_items_source').on(table.workspace_id, table.brain_source_id),
    index('idx_brain_items_container')
      .on(table.workspace_id, table.external_container_id)
      .where(sql`${table.external_container_id} IS NOT NULL`),
    index('idx_brain_items_name_search').using('gin', table.item_tsv),
  ],
);
