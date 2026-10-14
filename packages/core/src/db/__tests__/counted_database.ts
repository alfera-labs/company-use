import type { Database } from '@coworker/core/db/connection';
import * as schema from '@coworker/core/db/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

/**
 * Opens a real Postgres pool that counts its checked-out connections, so a test can prove how many
 * pooled connections one piece of work holds at once.
 */
export function open_counted_database(database_url: string, max: number) {
  const pool = new pg.Pool({ connectionString: database_url, max });
  return {
    db: drizzle(pool, { schema }) satisfies Database,
    ...count_pool_connections(pool),
    close: () => pool.end(),
  };
}

export function count_database_connections(db: Database) {
  return count_pool_connections((db as Database & { $client: pg.Pool }).$client);
}

function count_pool_connections(pool: pg.Pool) {
  let in_use = 0;
  let most = 0;
  pool.on('acquire', () => {
    in_use += 1;
    most = Math.max(most, in_use);
  });
  pool.on('release', () => {
    in_use -= 1;
  });
  return { in_use: () => in_use, most_in_use: () => most };
}
