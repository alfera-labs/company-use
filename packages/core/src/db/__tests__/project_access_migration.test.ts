import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { describe, expect, it } from 'vitest';

describe('0059 project access migration', () => {
  it('preserves old Personal rows and is safe to run twice', async () => {
    const client = new PGlite({ extensions: { vector } });
    const migrations_dir = resolve(import.meta.dirname, '../migrations');
    const earlier_migrations = readdirSync(migrations_dir)
      .filter((file_name) => file_name.endsWith('.sql') && file_name < '0062_')
      .sort();
    for (const file_name of earlier_migrations) {
      await run_migration(client, resolve(migrations_dir, file_name));
    }
    await client.exec(`
      INSERT INTO projects (
        project_id, workspace_id, project_name, project_status, membership_version,
        personal_for_user_id, metadata, created_by, last_updated_by
      ) VALUES (
        'proj_old_personal', 'ws_old', 'Personal', 'active', 1,
        'user_old', '{}'::jsonb, 'test', 'test'
      )
    `);

    const migration_path = resolve(migrations_dir, '0062_project_access_and_substance.sql');
    await run_migration(client, migration_path);
    await run_migration(client, migration_path);

    const old_rows = await client.query<{ project_access: string }>(
      "SELECT project_access FROM projects WHERE project_id = 'proj_old_personal'",
    );
    const constraints = await client.query<{ convalidated: boolean }>(`
      SELECT convalidated FROM pg_constraint
      WHERE conname = 'projects_personal_access_check'
    `);
    expect(old_rows.rows).toEqual([{ project_access: 'members' }]);
    expect(constraints.rows).toEqual([{ convalidated: false }]);
    await client.close();
  });
});

async function run_migration(client: PGlite, migration_path: string) {
  const migration_sql = readFileSync(migration_path, 'utf8');
  for (const statement of migration_sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) await client.exec(trimmed);
  }
}
