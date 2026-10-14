import { lifecycle_columns } from '@coworker/core/db/schema/common';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const connector_health = pgTable(
  'connector_health',
  {
    connector_health_id: text('connector_health_id').primaryKey(),
    app_key: text('app_key').notNull(),
    node_key: text('node_key').notNull(),
    checked_time: timestamp('checked_time', { withTimezone: true }).notNull().defaultNow(),
    ok: boolean('ok').notNull(),
    latency_ms: integer('latency_ms').notNull(),
    error_code: text('error_code'),
    ...lifecycle_columns,
  },
  (table) => [
    check('connector_health_latency_ms_check', sql`${table.latency_ms} >= 0`),
    check(
      'connector_health_error_code_check',
      sql`(${table.ok} AND ${table.error_code} IS NULL) OR (NOT ${table.ok} AND ${table.error_code} IS NOT NULL)`,
    ),
    index('idx_connector_health_app_checked').on(table.app_key, table.checked_time),
  ],
);
