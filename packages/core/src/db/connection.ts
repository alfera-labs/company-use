import { env, require_database_url } from '@coworker/config';
import { record_database_statement } from '@coworker/core/db/database_statement_count';
import * as schema from '@coworker/core/db/schema';
import { create_logger } from '@coworker/shared';
import type { Logger as DrizzleLogger } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

const log = create_logger('database');

let shared_pool: pg.Pool | null = null;
let shared_db: Database | null = null;

const return_idle_connections_and_retire_old_ones = {
  idleTimeoutMillis: 30_000,
  maxLifetimeSeconds: 30 * 60,
  connectionTimeoutMillis: 10_000,
} as const;

const statement_counter: DrizzleLogger = { logQuery: record_database_statement };

export function create_database(database_url = require_database_url()) {
  return open_database(open_pool(database_url));
}

export function get_database() {
  if (!shared_pool || !shared_db) {
    shared_pool = open_pool(require_database_url());
    shared_db = open_database(shared_pool);
  }

  return shared_db;
}

function open_database(pool: pg.Pool) {
  return drizzle(pool, { schema, logger: statement_counter });
}

function open_pool(database_url: string) {
  const pool = new pg.Pool({
    connectionString: database_url,
    max: database_pool_max(),
    ...return_idle_connections_and_retire_old_ones,
  });
  pool.on('error', (error) => log.warn('an idle database connection failed', { error }));
  return pool;
}

function database_pool_max() {
  if (env.NODE_ENV === 'test') return 1;
  return env.DATABASE_POOL_MAX;
}

export async function close_database() {
  if (shared_pool) {
    await shared_pool.end();
    shared_pool = null;
    shared_db = null;
  }
}
