import type { ScopeKindRecord } from '@coworker/memory/contracts/scopes';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';

type AnySchema = Record<string, unknown>;

export type MemoryDatabase = PgDatabase<PgQueryResultHKT, AnySchema>;
export type MemoryTransaction = PgTransaction<
  PgQueryResultHKT,
  AnySchema,
  ExtractTablesWithRelations<AnySchema>
>;
export type MemoryExecutor = MemoryDatabase | MemoryTransaction;

export type TextEmbedder = {
  model_id: string;
  dimensions: 1536;
  embed_texts(
    texts: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly (readonly number[])[]>;
};

export type MemoryDependencies = {
  extra_scope_kinds: readonly ScopeKindRecord[];
  embedder: TextEmbedder | null;
};
