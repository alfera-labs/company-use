import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { open_test_database } from '@coworker/core/db/__tests__/test_database';
import { claim_ready_event_jobs_for_queue, save_event_job_result } from '@coworker/jobs';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { describe, expect, it } from 'vitest';

const migrations_directory = resolve(import.meta.dirname, '../../../core/src/db/migrations');
const fencing_migrations = ['0077_event_job_fencing.sql', '0078_event_job_wake_index.sql'];

describe('event job fencing migration', () => {
  it('applies twice on a 0075 database, and a job queued before it still claims and finishes', async () => {
    const client = await database_migrated_before(fencing_migrations[0] ?? '');
    await queue_job_the_old_way(client);

    for (const migration_file of [...fencing_migrations, ...fencing_migrations]) {
      await run_migration(client, migration_file);
    }

    const columns = await client.query<{ column_name: string; column_default: string | null }>(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_name = 'event_jobs'
         AND column_name IN ('lock_token', 'wake_sent_time', 'interruption_count')
       ORDER BY column_name`,
    );
    const index = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_event_jobs_unacknowledged_wake'`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'interruption_count', column_default: '0' },
      { column_name: 'lock_token', column_default: null },
      { column_name: 'wake_sent_time', column_default: null },
    ]);
    expect(index.rows[0]?.indexdef).toContain(
      "(wake_sent_time) WHERE (job_status = 'queued'::text)",
    );

    const db = open_test_database(client);
    const [claimed] = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: 'ws_old',
      queue_key: 'slack:T1:C1:thread:1',
      worker_id: 'worker-after-deploy',
    });
    if (!claimed?.lock_token) throw new Error('Expected the old job to be claimed with a token');
    const [finished] = await save_event_job_result(db, {
      workspace_id: 'ws_old',
      job_ids: [claimed.job_id],
      lock_token: claimed.lock_token,
      result: { job_status: 'done' },
    });

    expect(claimed).toMatchObject({ job_id: 'ej_old', interruption_count: 0, attempt_count: 1 });
    expect(finished).toMatchObject({ job_status: 'done', lock_token: null });
    await client.close();
  });
});

async function database_migrated_before(first_new_migration: string) {
  const client = new PGlite({ extensions: { vector } });
  const migration_files = readdirSync(migrations_directory)
    .filter((file_name) => file_name.endsWith('.sql') && file_name < first_new_migration)
    .sort();
  for (const migration_file of migration_files) await run_migration(client, migration_file);
  return client;
}

async function run_migration(client: PGlite, migration_file: string) {
  const migration_sql = readFileSync(resolve(migrations_directory, migration_file), 'utf8');
  for (const statement of migration_sql.split('--> statement-breakpoint')) {
    const sql = statement.trim();
    if (sql) await client.exec(sql);
  }
}

async function queue_job_the_old_way(client: PGlite) {
  await client.exec(`
    INSERT INTO events (event_id, workspace_id, source, source_event_id, event_type, subject_key,
      actor_key, created_by, last_updated_by)
    VALUES ('evt_old', 'ws_old', 'test', 'old-1', 'message', 'slack:T1:C1:thread:1', 'user:a',
      'test', 'test');
    INSERT INTO event_jobs (job_id, workspace_id, event_id, subject_key, job_handler,
      available_time, created_by, last_updated_by)
    VALUES ('ej_old', 'ws_old', 'evt_old', 'slack:T1:C1:thread:1', 'test_handler',
      now() - interval '1 minute', 'test', 'test');
  `);
}
