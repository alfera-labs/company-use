import { getTableColumns, type InferSelectModel } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

export function read_table_row_from_json<TTable extends PgTable>(
  table: TTable,
  json: Record<string, unknown>,
): InferSelectModel<TTable> {
  const row: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const value = json[column.name];
    row[key] = value === null || value === undefined ? null : column.mapFromDriverValue(value);
  }
  return row as InferSelectModel<TTable>;
}
