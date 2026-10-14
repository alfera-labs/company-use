import { lifecycle_columns, metadata } from '@coworker/memory/store/schema/column_types';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const brain_item_revisions = pgTable(
  'brain_item_revisions',
  {
    brain_item_revision_id: text('brain_item_revision_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    brain_item_id: text('brain_item_id').notNull(),
    external_revision: text('external_revision'),
    content_text: text('content_text'),
    content_hash: text('content_hash').notNull(),
    raw_file_id: text('raw_file_id'),
    authored_by: text('authored_by').notNull(),
    recorded_time: timestamp('recorded_time', { withTimezone: true }).notNull().defaultNow(),
    superseded_time: timestamp('superseded_time', { withTimezone: true }),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    check(
      'brain_item_revisions_authored_by_check',
      sql`${table.authored_by} IN ('connector','agent','human','consolidation')`,
    ),
    uniqueIndex('idx_brain_item_revisions_external')
      .on(table.workspace_id, table.brain_item_id, table.external_revision)
      .where(sql`${table.external_revision} IS NOT NULL`),
    index('idx_brain_item_revisions_history').on(
      table.workspace_id,
      table.brain_item_id,
      table.recorded_time,
    ),
  ],
);
