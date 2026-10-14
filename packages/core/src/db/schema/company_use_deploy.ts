import { lifecycle_columns } from '@coworker/core/db/schema/common';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export type DeployProgressLine = {
  install_id: string;
  step: string;
  state: 'started' | 'done' | 'failed';
  reason: string | null;
  address: string | null;
  at: string;
};

export const company_use_deploy_sessions = pgTable(
  'company_use_deploy_sessions',
  {
    install_id: text('install_id').primaryKey(),
    report_token_hash: text('report_token_hash').notNull(),
    cloud: text('cloud').notNull(),
    progress_lines: jsonb('progress_lines')
      .$type<DeployProgressLine[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    expires_time: timestamp('expires_time', { withTimezone: true }).notNull(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_company_use_deploy_sessions_expires').on(table.expires_time),
    check('chk_company_use_deploy_sessions_cloud', sql`${table.cloud} IN ('digitalocean', 'aws')`),
  ],
);
