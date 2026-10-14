import { lifecycle_columns } from '@coworker/core/db/schema/common';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A connection that belongs to the whole install, not to one workspace: for example the AI key the
 * owner pasted on the setup page. Values are sealed with the credential envelope, as the values of
 * a workspace connection are.
 */
export const install_connections = pgTable(
  'install_connections',
  {
    connection_key: text('connection_key').primaryKey(),
    connection_status: text('connection_status').notNull(),
    credentials: jsonb('credentials').$type<ConnectionCredentialData>().notNull(),
    connection_metadata: jsonb('connection_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    last_checked_time: timestamp('last_checked_time', { withTimezone: true }),
    ...lifecycle_columns,
  },
  (table) => [
    check(
      'chk_install_connections_status',
      sql`${table.connection_status} IN ('active', 'invalid')`,
    ),
  ],
);
