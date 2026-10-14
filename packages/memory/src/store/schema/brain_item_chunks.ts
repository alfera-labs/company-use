import {
  brain_embedding_dimensions,
  halfvec,
  lifecycle_columns,
  metadata,
  tsvector,
} from '@coworker/memory/store/schema/column_types';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const brain_item_chunks = pgTable(
  'brain_item_chunks',
  {
    brain_item_chunk_id: text('brain_item_chunk_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    brain_item_id: text('brain_item_id').notNull(),
    brain_item_revision_id: text('brain_item_revision_id').notNull(),
    chunk_index: integer('chunk_index').notNull(),
    chunk_kind: text('chunk_kind').notNull().default('section'),
    chunk_text: text('chunk_text').notNull(),
    revision_start_char: integer('revision_start_char').notNull(),
    revision_end_char: integer('revision_end_char').notNull(),
    chunk_tsv: tsvector('chunk_tsv'),
    chunk_embedding: halfvec('chunk_embedding', { dimensions: brain_embedding_dimensions }),
    embedding_model_id: text('embedding_model_id'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    check(
      'brain_item_chunks_span_check',
      sql`${table.revision_end_char} >= ${table.revision_start_char}`,
    ),
    check(
      'brain_item_chunks_embedding_pair_check',
      sql`(${table.chunk_embedding} IS NULL) = (${table.embedding_model_id} IS NULL)`,
    ),
    uniqueIndex('idx_brain_item_chunks_slice').on(
      table.workspace_id,
      table.brain_item_revision_id,
      table.chunk_index,
    ),
    index('idx_brain_item_chunks_item').on(table.workspace_id, table.brain_item_id),
    index('idx_brain_item_chunks_search').using('gin', table.chunk_tsv),
  ],
);
