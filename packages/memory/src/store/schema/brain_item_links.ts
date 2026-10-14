import { lifecycle_columns, metadata } from '@coworker/memory/store/schema/column_types';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const brain_item_links = pgTable(
  'brain_item_links',
  {
    brain_item_link_id: text('brain_item_link_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    from_item_id: text('from_item_id').notNull(),
    to_item_id: text('to_item_id'),
    unresolved_ref: text('unresolved_ref'),
    link_kind: text('link_kind').notNull(),
    link_method: text('link_method').notNull(),
    relation: text('relation'),
    valid_from: timestamp('valid_from', { withTimezone: true }),
    valid_until: timestamp('valid_until', { withTimezone: true }),
    source_revision_id: text('source_revision_id').notNull(),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    check(
      'brain_item_links_target_check',
      sql`(${table.to_item_id} IS NULL) <> (${table.unresolved_ref} IS NULL)`,
    ),
    check(
      'brain_item_links_kind_check',
      sql`${table.link_kind} IN ('mentions','cites','in_container','thread')`,
    ),
    check(
      'brain_item_links_method_check',
      sql`${table.link_method} IN ('provider_native','url_rule','exact_ref','wikilink','runtime_provenance','authored','model_proposed','human','claim_receipt')`,
    ),
    check(
      'brain_item_links_relation_check',
      sql`${table.relation} IS NULL OR ${table.relation} ~ '^[a-z][a-z0-9_]{1,40}$'`,
    ),
    uniqueIndex('idx_brain_item_links_edge_v5').on(
      table.workspace_id,
      table.from_item_id,
      sql`coalesce(${table.relation}, ${table.link_kind})`,
      sql`coalesce(${table.to_item_id}, ${table.unresolved_ref})`,
      sql`coalesce(${table.metadata}->>'anchor', '')`,
    ),
    index('idx_brain_item_links_backlink')
      .on(table.workspace_id, table.to_item_id)
      .where(sql`${table.to_item_id} IS NOT NULL`),
    index('idx_brain_item_links_revision').on(table.workspace_id, table.source_revision_id),
    index('idx_brain_item_links_claim_text_search')
      .using('gin', sql`to_tsvector('simple', ${table.metadata}->>'claim_text')`)
      .where(sql`${table.link_method} = 'claim_receipt'`),
    index('idx_brain_item_links_claim_subject_valid')
      .on(table.workspace_id, sql`(${table.metadata}->>'subject_key')`, table.valid_from)
      .where(sql`${table.link_method} = 'claim_receipt'`),
    index('idx_brain_item_links_belongs_in_proposed')
      .on(table.workspace_id, sql`(${table.metadata}->>'author_actor')`)
      .where(
        sql`coalesce(${table.relation}, ${table.link_kind}) = 'belongs_in' AND ${table.metadata}->>'proposal_state' = 'proposed'`,
      ),
    index('idx_brain_item_links_relation_target').on(
      table.workspace_id,
      sql`coalesce(${table.relation}, ${table.link_kind})`,
      table.to_item_id,
    ),
  ],
);
