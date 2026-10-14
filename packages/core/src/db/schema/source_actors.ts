import { lifecycle_columns, metadata } from '@coworker/core/db/schema/common';
import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const source_actors = pgTable(
  'source_actors',
  {
    source_actor_id: text('source_actor_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    actor_kind: text('actor_kind').notNull().default('platform_user'),
    provider: text('provider'),
    external_id: text('external_id'),
    display_name: text('display_name'),
    email: text('email'),
    member_link_state: text('member_link_state').notNull().default('unlinked'),
    linked_user_id: text('linked_user_id'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_source_actors_provider_identity')
      .on(table.workspace_id, table.provider, table.external_id)
      .where(sql`${table.provider} IS NOT NULL AND ${table.external_id} IS NOT NULL`),
    index('idx_source_actors_workspace').on(table.workspace_id),
  ],
);
