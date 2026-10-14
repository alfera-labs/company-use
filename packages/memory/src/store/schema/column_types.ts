import { sql } from 'drizzle-orm';
import { customType, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

export const brain_embedding_dimensions = 1536;

export const halfvec = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
  configRequired: true;
}>({
  dataType(config) {
    return `halfvec(${config.dimensions})`;
  },
  fromDriver(value) {
    return value
      .slice(1, -1)
      .split(',')
      .map((component) => Number.parseFloat(component));
  },
  toDriver(value) {
    return JSON.stringify(value);
  },
});

export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const metadata = <T extends Record<string, unknown> = Record<string, unknown>>() =>
  jsonb('metadata').$type<T>().notNull().default(sql`'{}'::jsonb`);

export const lifecycle_columns = {
  created_time: timestamp('created_time', { withTimezone: true }).notNull().defaultNow(),
  last_updated_time: timestamp('last_updated_time', { withTimezone: true }).notNull().defaultNow(),
  created_by: text('created_by').notNull(),
  last_updated_by: text('last_updated_by').notNull(),
};
