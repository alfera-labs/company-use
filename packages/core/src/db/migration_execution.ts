const non_transactional_migration_marker = '-- coworker-migration: no-transaction';

export type ConcurrentIndexState = {
  index_schema: string;
  index_name: string;
  is_valid: boolean;
};

type ConcurrentIndexExecutor = {
  find_index: (index_name: string) => Promise<ConcurrentIndexState | null>;
  drop_invalid_index: (index: ConcurrentIndexState) => Promise<void>;
  execute: (statement: string) => Promise<void>;
};

type MigrationExecutor = {
  run_in_transaction: (statements: string[]) => Promise<void>;
  run_without_transaction: (statements: string[]) => Promise<void>;
};

function migration_runs_without_transaction(migration_sql: string) {
  const first_content_line = migration_sql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first_content_line === non_transactional_migration_marker;
}

export function split_migration_statements(migration_sql: string) {
  return migration_sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function execute_migration_sql(migration_sql: string, executor: MigrationExecutor) {
  const statements = split_migration_statements(migration_sql);
  if (migration_runs_without_transaction(migration_sql)) {
    await executor.run_without_transaction(statements);
    return 'without_transaction' as const;
  }

  await executor.run_in_transaction(statements);
  return 'transaction' as const;
}

export async function execute_concurrent_index_migration(
  statements: string[],
  executor: ConcurrentIndexExecutor,
) {
  for (const statement of statements) {
    const index_name = read_concurrent_index_name(statement);
    if (!index_name) {
      throw new Error(
        'Non-transactional migrations may only contain CREATE INDEX CONCURRENTLY IF NOT EXISTS statements.',
      );
    }

    const existing_index = await executor.find_index(index_name);
    if (existing_index && !existing_index.is_valid) {
      await executor.drop_invalid_index(existing_index);
    }
    await executor.execute(statement);
    const created_index = await executor.find_index(index_name);
    if (!created_index?.is_valid) {
      throw new Error(`Concurrent index ${index_name} was not created as a valid index.`);
    }
  }
}

function read_concurrent_index_name(statement: string) {
  const match = statement.match(
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+(?:"((?:[^"]|"")+)"|([a-z_][a-z0-9_$]*))/i,
  );
  const quoted_name = match?.[1]?.replaceAll('""', '"');
  return quoted_name ?? match?.[2] ?? null;
}
