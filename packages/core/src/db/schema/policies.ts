import { lifecycle_columns, metadata } from '@coworker/core/db/schema/common';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const policy_modes = ['allow', 'ask', 'never'] as const;
export type PolicyMode = (typeof policy_modes)[number];

export const policy_scope_types = ['workspace', 'connection', 'project', 'agent', 'user'] as const;
export type PolicyScopeType = (typeof policy_scope_types)[number];

export const policies = pgTable(
  'policies',
  {
    policy_id: text('policy_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    resource_type: text('resource_type').notNull(),
    resource_id: text('resource_id').notNull(),
    scope_type: text('scope_type').notNull(),
    scope_id: text('scope_id').notNull(),
    policy_mode: text('policy_mode', { enum: policy_modes }).notNull(),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    check('policies_mode_check', sql`${table.policy_mode} IN ('allow','ask','never')`),
    uniqueIndex('idx_policies_unique').on(
      table.workspace_id,
      table.resource_type,
      table.resource_id,
      table.scope_type,
      table.scope_id,
    ),
    index('idx_policies_scope').on(table.workspace_id, table.scope_type, table.scope_id),
    index('idx_policies_resource').on(table.workspace_id, table.resource_type, table.resource_id),
  ],
);
