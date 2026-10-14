import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { run_after_earlier_runs } from '@coworker/shared';
import { PgTransaction } from 'drizzle-orm/pg-core';

/**
 * Runs writes that share a key one at a time in this process. Postgres serializes these writes on
 * a lock anyway (one run's events, one session's messages), and a write that waits for that lock
 * holds a pooled connection, so one busy run could take the whole pool. A write waiting here holds
 * no connection. The Postgres lock still orders writes from other processes. A write inside a
 * transaction already holds its connection, so it skips this queue and waits in Postgres.
 */
export function write_after_earlier_writes<T>(
  db: DatabaseExecutor,
  key: string,
  write: () => Promise<T>,
): Promise<T> {
  if (db instanceof PgTransaction) return write();
  return run_after_earlier_runs(`database_write:${key}`, write);
}
