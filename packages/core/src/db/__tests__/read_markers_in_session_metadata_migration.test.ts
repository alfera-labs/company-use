import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { describe, expect, it } from 'vitest';

const migrations_directory = resolve(import.meta.dirname, '../migrations');
const drop_migration = '0050_read_markers_in_session_metadata.sql';

describe('read markers into session metadata', () => {
  it('carries every reader of a chat across, and drops the table behind them', async () => {
    const client = new PGlite({ extensions: { vector } });
    await run_migrations_before_drop(client);
    await insert_chat(client, 'ses_stripe');
    await insert_chat(client, 'ses_payroll');
    await insert_marker(client, { session_id: 'ses_stripe', reader_id: 'user_ana', sequence: 12 });
    await insert_marker(client, { session_id: 'ses_stripe', reader_id: 'user_bo', sequence: 4 });
    await insert_marker(client, { session_id: 'ses_payroll', reader_id: 'user_ana', sequence: 7 });

    await run_migration(client, drop_migration);

    expect(await read_markers_of(client, 'ses_stripe')).toEqual({ user_ana: 12, user_bo: 4 });
    expect(await read_markers_of(client, 'ses_payroll')).toEqual({ user_ana: 7 });
    expect(await table_exists(client, 'read_markers')).toBe(false);

    await client.close();
  });

  it('keeps the metadata a chat already had', async () => {
    const client = new PGlite({ extensions: { vector } });
    await run_migrations_before_drop(client);
    await insert_chat(client, 'ses_slack', `'{"actors":[{"external_user_id":"U123"}]}'::jsonb`);
    await insert_marker(client, { session_id: 'ses_slack', reader_id: 'user_ana', sequence: 3 });

    await run_migration(client, drop_migration);

    const metadata = await session_metadata_of(client, 'ses_slack');
    expect(metadata.actors).toEqual([{ external_user_id: 'U123' }]);
    expect(metadata.read_markers).toEqual({ user_ana: 3 });

    await client.close();
  });

  it('leaves a chat nobody had read without a marker map at all', async () => {
    const client = new PGlite({ extensions: { vector } });
    await run_migrations_before_drop(client);
    await insert_chat(client, 'ses_untouched');

    await run_migration(client, drop_migration);

    expect(await session_metadata_of(client, 'ses_untouched')).toEqual({});

    await client.close();
  });

  it('is safe to run twice', async () => {
    const client = new PGlite({ extensions: { vector } });
    await run_migrations_before_drop(client);
    await insert_chat(client, 'ses_stripe');
    await insert_marker(client, { session_id: 'ses_stripe', reader_id: 'user_ana', sequence: 12 });

    await run_migration(client, drop_migration);
    await run_migration(client, drop_migration);

    expect(await read_markers_of(client, 'ses_stripe')).toEqual({ user_ana: 12 });

    await client.close();
  });
});

async function run_migrations_before_drop(client: PGlite) {
  const migration_files = readdirSync(migrations_directory)
    .filter((file_name) => file_name.endsWith('.sql') && file_name < drop_migration)
    .sort();
  for (const migration_file of migration_files) await run_migration(client, migration_file);
}

async function run_migration(client: PGlite, migration_file: string) {
  const migration_sql = readFileSync(resolve(migrations_directory, migration_file), 'utf8');
  for (const statement of migration_sql.split('--> statement-breakpoint')) {
    const sql = statement.trim();
    if (sql) await client.exec(sql);
  }
}

async function insert_chat(client: PGlite, session_id: string, metadata = `'{}'::jsonb`) {
  await client.exec(`
    INSERT INTO sessions (session_id, workspace_id, agent_id, session_metadata, created_by, last_updated_by)
    VALUES ('${session_id}', 'ws_1', 'agent_1', ${metadata}, 'user_ana', 'user_ana')
  `);
}

async function insert_marker(
  client: PGlite,
  input: { session_id: string; reader_id: string; sequence: number },
) {
  await client.exec(`
    INSERT INTO read_markers (
      read_marker_id, workspace_id, subject_type, subject_id, reader_id, last_read_sequence,
      created_by, last_updated_by
    ) VALUES (
      'rmark_${input.session_id}_${input.reader_id}', 'ws_1', 'session', '${input.session_id}',
      '${input.reader_id}', ${input.sequence}, '${input.reader_id}', '${input.reader_id}'
    )
  `);
}

async function session_metadata_of(client: PGlite, session_id: string) {
  const result = await client.query<{ session_metadata: Record<string, unknown> }>(
    'SELECT session_metadata FROM sessions WHERE session_id = $1',
    [session_id],
  );
  return result.rows[0]?.session_metadata ?? {};
}

async function read_markers_of(client: PGlite, session_id: string) {
  return (await session_metadata_of(client, session_id)).read_markers;
}

async function table_exists(client: PGlite, table_name: string) {
  const result = await client.query<{ exists: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [`public.${table_name}`],
  );
  return result.rows[0]?.exists ?? false;
}
