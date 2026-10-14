import { AsyncLocalStorage } from 'node:async_hooks';

type DatabaseStatementCount = { statement_count: number };

const request_statement_counts = new AsyncLocalStorage<DatabaseStatementCount>();

export async function count_database_statements<T>(
  run: () => Promise<T>,
): Promise<{ result: T; statement_count: number }> {
  const count: DatabaseStatementCount = { statement_count: 0 };
  const result = await request_statement_counts.run(count, run);
  return { result, statement_count: count.statement_count };
}

export function record_database_statement() {
  const count = request_statement_counts.getStore();
  if (count) count.statement_count += 1;
}
