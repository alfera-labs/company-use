import { lifecycle_columns, metadata } from '@coworker/memory/store/schema/column_types';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export type BrainSyncScope = {
  dimension?: string | undefined;
  select_all?: boolean | undefined;
  selected?: { id: string; label: string }[] | undefined;
  query?: string | null | undefined;
  folder_ids?: string[] | undefined;
};

export type BrainSyncCursor = {
  cursor_key?: string;
  watermark?: string | null;
  page?: string | null;
  sweep_id?: string | null;
  listing_sweepable?: boolean;
  pending_watermark?: string | null;
};

export type BrainSyncObjectProgress = {
  key: string;
  label: string;
  listed: number;
  stored: number;
  secrets_redacted?: number;
  state: 'queued' | 'running' | 'done' | 'failed';
};

export type BrainSyncState = {
  cursors?: Record<string, BrainSyncCursor>;
  resume_scopes?: Record<string, string>;
  progress?: {
    objects: BrainSyncObjectProgress[];
    swept_time?: string;
  };
};

export type BrainSourceError = {
  error_code: string;
  error_message: string;
  error_time?: string;
  detail?: Record<string, unknown>;
};

export const brain_sources = pgTable(
  'brain_sources',
  {
    brain_source_id: text('brain_source_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    connection_id: text('connection_id'),
    app_key: text('app_key').notNull(),
    source_name: text('source_name').notNull(),
    sync_scope: jsonb('sync_scope').$type<BrainSyncScope>().notNull().default(sql`'{}'::jsonb`),
    sync_state: jsonb('sync_state').$type<BrainSyncState>().notNull().default(sql`'{}'::jsonb`),
    sync_status: text('sync_status').notNull().default('never_synced'),
    backfill_state: text('backfill_state').notNull().default('unknown'),
    sync_cadence: text('sync_cadence').notNull().default('daily'),
    last_synced_time: timestamp('last_synced_time', { withTimezone: true }),
    last_error: jsonb('last_error').$type<BrainSourceError>(),
    document_count: integer('document_count').notNull().default(0),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    check(
      'brain_sources_sync_status_check',
      sql`${table.sync_status} IN ('never_synced','syncing','connected','stalled','broken','rate_limited','paused')`,
    ),
    check(
      'brain_sources_backfill_state_check',
      sql`${table.backfill_state} IN ('backfilling','quiesced','completed','unknown')`,
    ),
    check(
      'brain_sources_sync_cadence_check',
      sql`${table.sync_cadence} IN ('hourly','daily','weekly','manual')`,
    ),
    check('brain_sources_document_count_check', sql`${table.document_count} >= 0`),
    index('idx_brain_sources_workspace').on(table.workspace_id, table.created_time),
    index('idx_brain_sources_connection')
      .on(table.workspace_id, table.connection_id)
      .where(sql`${table.connection_id} IS NOT NULL`),
  ],
);
