import { lifecycle_columns } from '@coworker/core/db/schema/common';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const scheduler_ticks = pgTable('scheduler_ticks', {
  tick_name: text('tick_name').primaryKey(),
  last_tick_time: timestamp('last_tick_time', { withTimezone: true }).notNull(),
  ...lifecycle_columns,
});
