import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migration_path = resolve(
  import.meta.dirname,
  '../migrations/0030_event_job_recovery_indexes.sql',
);

describe('event job recovery index migration', () => {
  it('indexes global ready work, ready subjects, and expired running locks', async () => {
    const client = new PGlite();
    await client.exec(`
      CREATE TABLE event_jobs (
        job_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        subject_key text NOT NULL,
        job_status text NOT NULL,
        available_time timestamp with time zone NOT NULL,
        locked_until timestamp with time zone,
        created_time timestamp with time zone NOT NULL
      )
    `);

    const migration_sql = readFileSync(migration_path, 'utf8');
    for (const statement of migration_sql.split('--> statement-breakpoint')) {
      const trimmed_statement = statement.trim();
      if (trimmed_statement) await client.exec(trimmed_statement);
    }

    const indexes = await client.query<{ indexdef: string; indexname: string }>(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'event_jobs'
        AND indexname IN (
          'idx_event_jobs_global_ready',
          'idx_event_jobs_ready_subjects',
          'idx_event_jobs_expired_lock'
        )
      ORDER BY indexname
    `);

    const indexes_by_name = new Map(indexes.rows.map((index) => [index.indexname, index.indexdef]));
    expect(indexes.rows).toHaveLength(3);
    expect(indexes_by_name.get('idx_event_jobs_expired_lock')).toContain('(locked_until, job_id)');
    expect(indexes_by_name.get('idx_event_jobs_expired_lock')).toContain(
      "WHERE (job_status = 'running'::text)",
    );
    expect(indexes_by_name.get('idx_event_jobs_global_ready')).toContain(
      '(available_time, created_time, job_id, workspace_id, subject_key)',
    );
    expect(indexes_by_name.get('idx_event_jobs_ready_subjects')).toContain(
      '(workspace_id, subject_key, available_time, created_time, job_id)',
    );
    expect(indexes_by_name.get('idx_event_jobs_global_ready')).toContain(
      "WHERE (job_status = 'queued'::text)",
    );
    expect(indexes_by_name.get('idx_event_jobs_ready_subjects')).toContain(
      "WHERE (job_status = 'queued'::text)",
    );
    await client.close();
  });
});
