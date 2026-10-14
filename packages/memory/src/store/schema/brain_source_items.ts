import { lifecycle_columns } from '@coworker/memory/store/schema/column_types';
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const brain_source_items = pgTable(
  'brain_source_items',
  {
    brain_source_item_id: text('brain_source_item_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    brain_source_id: text('brain_source_id').notNull(),
    brain_item_id: text('brain_item_id').notNull(),
    last_seen_sweep_id: text('last_seen_sweep_id'),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_brain_source_items_membership').on(
      table.workspace_id,
      table.brain_source_id,
      table.brain_item_id,
    ),
    index('idx_brain_source_items_item').on(table.workspace_id, table.brain_item_id),
  ],
);
