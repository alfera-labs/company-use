import { type SQL, sql } from 'drizzle-orm';
import { jsonb, type PgColumn, text, timestamp } from 'drizzle-orm/pg-core';

export const metadata = <T extends Record<string, unknown> = Record<string, unknown>>() =>
  jsonb('metadata').$type<T>().notNull().default(sql`'{}'::jsonb`);

export function merge_metadata(column: PgColumn, patch: Record<string, unknown>): SQL {
  return sql`coalesce(${column}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
}

export const lifecycle_columns = {
  created_time: timestamp('created_time', { withTimezone: true }).notNull().defaultNow(),
  last_updated_time: timestamp('last_updated_time', { withTimezone: true }).notNull().defaultNow(),
  created_by: text('created_by').notNull(),
  last_updated_by: text('last_updated_by').notNull(),
};

export function updated_by(actor: string | SQL | PgColumn) {
  return { last_updated_time: sql`now()`, last_updated_by: actor };
}

export function unchanged_lifecycle_columns(table: {
  last_updated_time: PgColumn;
  last_updated_by: PgColumn;
}) {
  return { last_updated_time: table.last_updated_time, last_updated_by: table.last_updated_by };
}
