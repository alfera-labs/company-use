import { lifecycle_columns } from '@coworker/core/db/schema/common';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Team mode's own sign-in. A link and a session are each a random secret the browser holds;
 * only the SHA-256 of the secret is stored, and the hash is the row's key.
 */
export const team_sign_in_links = pgTable(
  'team_sign_in_links',
  {
    token_hash: text('token_hash').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    user_id: text('user_id').notNull(),
    expires_time: timestamp('expires_time', { withTimezone: true }).notNull(),
    used_time: timestamp('used_time', { withTimezone: true }),
    ...lifecycle_columns,
  },
  (table) => [index('idx_team_sign_in_links_user').on(table.workspace_id, table.user_id)],
);

export const team_sessions = pgTable(
  'team_sessions',
  {
    session_hash: text('session_hash').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    user_id: text('user_id').notNull(),
    expires_time: timestamp('expires_time', { withTimezone: true }).notNull(),
    ...lifecycle_columns,
  },
  (table) => [index('idx_team_sessions_user').on(table.workspace_id, table.user_id)],
);
