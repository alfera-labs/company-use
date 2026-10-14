import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type ConcurrentIndexState,
  execute_concurrent_index_migration,
  execute_migration_sql,
  split_migration_statements,
} from '@coworker/core/db/migration_execution';
import { describe, expect, it, vi } from 'vitest';

const migrations_directory = resolve(import.meta.dirname, '../migrations');

describe('migration execution', () => {
  it('dispatches concurrent index migrations outside a transaction', async () => {
    const migration_name = '0033_node_key_unique_indexes';
    const migration_sql = read_migration(migration_name);
    const run_in_transaction = vi.fn(async (_statements: string[]) => undefined);
    const run_without_transaction = vi.fn(async (_statements: string[]) => undefined);

    const execution_mode = await execute_migration_sql(migration_sql, {
      run_in_transaction,
      run_without_transaction,
    });

    expect(execution_mode).toBe('without_transaction');
    expect(run_in_transaction).not.toHaveBeenCalled();
    expect(run_without_transaction).toHaveBeenCalledOnce();
    for (const statement of run_without_transaction.mock.calls[0]?.[0] ?? []) {
      expect(statement).toMatch(/CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS/i);
    }
  });

  it('keeps ordinary migrations atomic', async () => {
    const run_in_transaction = vi.fn(async (_statements: string[]) => undefined);
    const run_without_transaction = vi.fn(async (_statements: string[]) => undefined);

    const execution_mode = await execute_migration_sql(
      read_migration('0025_connection_setup_expiry'),
      { run_in_transaction, run_without_transaction },
    );

    expect(execution_mode).toBe('transaction');
    expect(run_in_transaction).toHaveBeenCalledOnce();
    expect(run_without_transaction).not.toHaveBeenCalled();
  });

  it('removes an invalid concurrent index before retrying its failed build', async () => {
    const [statement] = split_migration_statements(
      read_migration('0030_event_job_recovery_indexes'),
    );
    if (!statement) throw new Error('Recovery-index migration has no statement.');

    let stored_index: ConcurrentIndexState | null = null;
    let fail_first_build = true;
    const dropped_indexes: ConcurrentIndexState[] = [];
    const executor = {
      find_index: async () => stored_index,
      drop_invalid_index: async (index: ConcurrentIndexState) => {
        dropped_indexes.push(index);
        stored_index = null;
      },
      execute: async () => {
        if (fail_first_build) {
          fail_first_build = false;
          stored_index = recovery_index(false);
          throw new Error('simulated interrupted concurrent build');
        }
        stored_index = recovery_index(true);
      },
    };

    await expect(execute_concurrent_index_migration([statement], executor)).rejects.toThrow(
      'simulated interrupted concurrent build',
    );
    expect(stored_index).toEqual(recovery_index(false));

    await expect(
      execute_concurrent_index_migration([statement], executor),
    ).resolves.toBeUndefined();
    expect(dropped_indexes).toEqual([recovery_index(false)]);
    expect(stored_index).toEqual(recovery_index(true));
  });

  it('preserves a valid index when retrying after the migration-record insert was interrupted', async () => {
    const [statement] = split_migration_statements(
      read_migration('0030_event_job_recovery_indexes'),
    );
    if (!statement) throw new Error('Recovery-index migration has no statement.');
    const drop_invalid_index = vi.fn(async () => undefined);
    const execute = vi.fn(async () => undefined);

    await execute_concurrent_index_migration([statement], {
      find_index: async () => recovery_index(true),
      drop_invalid_index,
      execute,
    });

    expect(drop_invalid_index).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects non-idempotent statements in non-transactional migrations', async () => {
    await expect(
      execute_concurrent_index_migration(['ALTER TABLE event_jobs ADD COLUMN unsafe text'], {
        find_index: async () => null,
        drop_invalid_index: async () => undefined,
        execute: async () => undefined,
      }),
    ).rejects.toThrow(/only contain CREATE INDEX CONCURRENTLY IF NOT EXISTS/i);
  });

  it('does not mark a concurrent migration successful without a valid index', async () => {
    const [statement] = split_migration_statements(
      read_migration('0030_event_job_recovery_indexes'),
    );
    if (!statement) throw new Error('Recovery-index migration has no statement.');

    await expect(
      execute_concurrent_index_migration([statement], {
        find_index: async () => null,
        drop_invalid_index: async () => undefined,
        execute: async () => undefined,
      }),
    ).rejects.toThrow(/was not created as a valid index/i);
  });
});

function read_migration(migration_name: string) {
  return readFileSync(resolve(migrations_directory, `${migration_name}.sql`), 'utf8');
}

function recovery_index(is_valid: boolean): ConcurrentIndexState {
  return {
    index_schema: 'public',
    index_name: 'idx_event_jobs_global_ready',
    is_valid,
  };
}
