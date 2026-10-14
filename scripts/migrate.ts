import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { require_database_url } from '@coworker/config';
import {
  type ConcurrentIndexState,
  execute_concurrent_index_migration,
  execute_migration_sql,
} from '@coworker/core/db/migration_execution';
import postgres from 'postgres';

const database_url = require_database_url();

const migrations_directory = resolve(import.meta.dirname, '../packages/core/src/db/migrations');
const client = postgres(database_url, { max: 1, prepare: false });

type JournalEntry = {
  tag: string;
  when: number;
};

const migration_presence_checks: Record<string, () => Promise<boolean>> = {
  '0000_premium_hannibal_king': baseline_schema_exists,
  '0001_overconfident_tomas': v2_schema_exists,
  '0002_run_observability_ledger': run_observability_schema_exists,
  '0003_workspace_artifacts': workspace_artifacts_schema_exists,
  '0004_minimal_trust_loop_gate': minimal_trust_loop_gate_schema_exists,
  '0005_ship_ready_cancel_idempotency': ship_ready_cancel_idempotency_schema_exists,
  '0006_clear_runtime_record_names': clear_runtime_record_names_schema_exists,
  '0008_session_harness_storage': session_harness_storage_schema_exists,
  '0009_sandbox_records': sandbox_records_schema_exists,
  '0010_connection_management_v1': connection_management_v1_schema_exists,
  '0011_trigger_shape': trigger_shape_schema_exists,
  '0012_channels': channels_schema_exists,
};

async function main() {
  // A migration must fail and be retried instead of waiting behind a long application transaction
  // while its queued table lock makes new application queries pile up behind it.
  await client`SET lock_timeout = '5s'`;
  await client`SELECT pg_advisory_lock(hashtext('coworker_schema_migrations'))`;
  try {
    await ensure_migration_table();

    const applied_hashes = await get_applied_hashes();
    const journal = read_journal();

    for (const entry of journal) {
      const migration_file = join(migrations_directory, `${entry.tag}.sql`);
      const migration_sql = readFileSync(migration_file, 'utf8');
      const migration_hash = hash_migration(migration_sql);

      if (applied_hashes.has(migration_hash)) {
        console.log(`migration ${entry.tag} already applied`);
        continue;
      }

      await apply_migration(entry, migration_sql, migration_hash);
    }
  } finally {
    await client`SELECT pg_advisory_unlock(hashtext('coworker_schema_migrations'))`;
    await client.end();
  }
}

async function ensure_migration_table() {
  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
}

async function get_applied_hashes() {
  const rows = await client<{ hash: string }[]>`SELECT hash FROM drizzle.__drizzle_migrations`;
  return new Set(rows.map((row) => row.hash));
}

function read_journal() {
  const journal_path = join(migrations_directory, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journal_path, 'utf8')) as { entries: JournalEntry[] };
  return journal.entries;
}

async function apply_migration(entry: JournalEntry, migration_sql: string, migration_hash: string) {
  try {
    await execute_migration_sql(migration_sql, {
      run_in_transaction: (statements) =>
        client.begin(async (transaction) => {
          for (const statement of statements) {
            await transaction.unsafe(statement);
          }
          await transaction`
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES (${migration_hash}, ${entry.when})
          `;
        }),
      run_without_transaction: async (statements) => {
        await execute_concurrent_index_migration(statements, {
          find_index: find_concurrent_index,
          drop_invalid_index: drop_invalid_concurrent_index,
          execute: (statement) => client.unsafe(statement).then(() => undefined),
        });
        // A crash before this insert is safe: valid concurrent indexes are preserved on retry,
        // while an invalid index left by PostgreSQL is removed before the statement runs again.
        await client`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${migration_hash}, ${entry.when})
        `;
      },
    });
    console.log(`applied migration ${entry.tag}`);
  } catch (error) {
    const migration_is_present = migration_presence_checks[entry.tag];
    if (is_already_applied_migration_error(error) && migration_is_present && (await migration_is_present())) {
      await client`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${migration_hash}, ${entry.when})
      `;
      console.log(`marked existing migration ${entry.tag} as applied`);
      return;
    }

    throw error;
  }
}

async function find_concurrent_index(index_name: string) {
  const [index] = await client<ConcurrentIndexState[]>`
    SELECT
      index_namespace.nspname AS index_schema,
      index_relation.relname AS index_name,
      index_metadata.indisvalid AS is_valid
    FROM pg_index index_metadata
    JOIN pg_class index_relation ON index_relation.oid = index_metadata.indexrelid
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_relation.relnamespace
    WHERE index_metadata.indexrelid = to_regclass(${index_name})
  `;
  return index ?? null;
}

async function drop_invalid_concurrent_index(index: ConcurrentIndexState) {
  if (index.is_valid) return;
  const qualified_name = `${quote_identifier(index.index_schema)}.${quote_identifier(index.index_name)}`;
  await client.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${qualified_name}`);
}

function quote_identifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function is_already_applied_migration_error(error: unknown) {
  const pg_error = error as { code?: string; message?: string };
  return pg_error.code === '42P07' || pg_error.message?.includes('already exists') === true;
}

async function baseline_schema_exists() {
  const expected_tables = [
    'users',
    'workspaces',
    'workspace_members',
    'agents',
    'sessions',
    'runs',
    'run_messages',
    'tool_calls',
    'apps',
    'nodes',
    'connections',
    'triggers',
    'usage_records',
    'billing_plans',
    'subscriptions',
  ];
  const rows = await client<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expected_tables})
  `;

  return rows.length === expected_tables.length;
}

async function v2_schema_exists() {
  const expected_tables = ['agent_nodes', 'runtime_environments'];
  const expected_columns = [
    ['agents', 'agent_slug'],
    ['agents', 'agent_kind'],
    ['agents', 'system_prompt'],
    ['agents', 'default_model'],
    ['agents', 'agent_config'],
    ['nodes', 'node_runtime'],
    ['run_messages', 'message_kind'],
    ['run_messages', 'content_text'],
    ['run_messages', 'content_json'],
    ['run_messages', 'tool_call_id'],
    ['run_messages', 'token_count'],
    ['run_messages', 'is_visible_to_user'],
    ['runs', 'run_reason'],
    ['runs', 'provider_name'],
    ['runs', 'input_tokens'],
    ['runs', 'output_tokens'],
    ['runs', 'cache_read_tokens'],
    ['runs', 'cache_write_tokens'],
    ['runs', 'cost_microcents'],
    ['runs', 'finished_time'],
    ['runs', 'duration_ms'],
    ['runs', 'error_code'],
    ['runs', 'run_metadata'],
    ['sessions', 'session_source'],
    ['sessions', 'external_thread_key'],
    ['sessions', 'context_summary'],
    ['sessions', 'summarized_until_message_id'],
    ['sessions', 'active_run_id'],
    ['sessions', 'locked_by_run_id'],
    ['sessions', 'lock_expires_time'],
    ['sessions', 'runtime_environment_id'],
    ['sessions', 'last_message_time'],
    ['sessions', 'last_message_preview'],
    ['sessions', 'session_metadata'],
    ['tool_calls', 'agent_id'],
    ['tool_calls', 'connection_id'],
    ['tool_calls', 'input_json'],
    ['tool_calls', 'output_json'],
    ['tool_calls', 'output_text'],
    ['tool_calls', 'error_code'],
    ['tool_calls', 'tool_metadata'],
    ['tool_calls', 'finished_time'],
    ['triggers', 'trigger_name'],
    ['usage_records', 'provider_name'],
    ['usage_records', 'cost_microcents'],
    ['usage_records', 'usage_metadata'],
  ] as const;

  const table_rows = await client<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expected_tables})
  `;

  if (table_rows.length !== expected_tables.length) return false;

  const column_rows = await client<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const existing_columns = new Set(
    column_rows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  return expected_columns.every(
    ([table_name, column_name]) => existing_columns.has(`${table_name}.${column_name}`),
  );
}

async function run_observability_schema_exists() {
  const expected_tables = ['run_events', 'run_model_context_snapshots'];
  const expected_columns = [
    ['run_events', 'event_payload'],
    ['run_events', 'event_sequence'],
    ['run_model_context_snapshots', 'snapshot'],
    ['run_model_context_snapshots', 'snapshot_kind'],
    ['run_model_context_snapshots', 'token_estimate'],
  ] as const;

  const table_rows = await client<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expected_tables})
  `;

  if (table_rows.length !== expected_tables.length) return false;

  const column_rows = await client<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const existing_columns = new Set(
    column_rows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  return expected_columns.every(
    ([table_name, column_name]) => existing_columns.has(`${table_name}.${column_name}`),
  );
}

// Baseline detector for 0003: does this database already have what 0003 creates?
// These names are HISTORY and must not be renamed. 0003 created `artifacts` with
// `artifact_id`; 0048 renamed it to `files`. A database that needs this check is one
// whose journal predates it, so the schema it has is 0003's, not today's. Renaming
// these makes the check return false on such a database and re-run CREATE TABLE
// against a table that already exists.
async function workspace_artifacts_schema_exists() {
  const expected_tables = ['artifacts'];
  const expected_columns = [
    ['tool_calls', 'risk_class'],
    ['tool_calls', 'approval_mode'],
    ['tool_calls', 'output_artifact_id'],
    ['artifacts', 'artifact_id'],
    ['artifacts', 'runtime_environment_id'],
    ['artifacts', 'source_tool_call_id'],
    ['artifacts', 'storage_key'],
    ['artifacts', 'checksum_sha256'],
  ] as const;

  const table_rows = await client<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expected_tables})
  `;

  if (table_rows.length !== expected_tables.length) return false;

  const column_rows = await client<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const existing_columns = new Set(
    column_rows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  return expected_columns.every(
    ([table_name, column_name]) => existing_columns.has(`${table_name}.${column_name}`),
  );
}

async function ship_ready_cancel_idempotency_schema_exists() {
  const expected_columns = [
    ['runs', 'cancel_requested_time'],
    ['runs', 'cancel_requested_by'],
    ['tool_calls', 'idempotency_key'],
  ] as const;

  const column_rows = await client<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const existing_columns = new Set(
    column_rows.map((row) => `${row.table_name}.${row.column_name}`),
  );
  return expected_columns.every(
    ([table_name, column_name]) => existing_columns.has(`${table_name}.${column_name}`),
  );
}

async function minimal_trust_loop_gate_schema_exists() {
  const expected_tables = ['eval_reports'];
  const expected_columns = [
    ['run_events', 'tool_call_id'],
    ['runs', 'context_compile_ms'],
    ['runs', 'engine_first_event_ms'],
    ['runs', 'model_total_ms'],
    ['runs', 'tool_total_ms'],
    ['runs', 'db_write_total_ms'],
    ['runs', 'total_run_ms'],
    ['runs', 'cost_microcents_estimate'],
    ['eval_reports', 'eval_report_id'],
    ['eval_reports', 'suite_name'],
    ['eval_reports', 'failure_reason'],
    ['eval_reports', 'cost_microcents'],
  ] as const;

  const table_rows = await client<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expected_tables})
  `;

  if (table_rows.length !== expected_tables.length) return false;

  const column_rows = await client<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const existing_columns = new Set(
    column_rows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  return expected_columns.every(
    ([table_name, column_name]) => existing_columns.has(`${table_name}.${column_name}`),
  );
}

async function clear_runtime_record_names_schema_exists() {
  return columns_exist([
    ['run_events', 'event_data'],
    ['run_events', 'event_metadata'],
    ['run_model_context_snapshots', 'snapshot_metadata'],
  ]);
}

async function session_harness_storage_schema_exists() {
  return columns_exist([
    ['sessions', 'active_leaf_entry_id'],
    ['session_tree_entries', 'session_tree_entry_id'],
    ['session_context_operations', 'session_context_operation_id'],
  ]);
}

async function sandbox_records_schema_exists() {
  return columns_exist([
    ['sandboxes', 'sandbox_id'],
    ['runtime_environments', 'sandbox_id'],
  ]);
}

async function connection_management_v1_schema_exists() {
  return columns_exist([
    ['connections', 'connection_key'],
    ['connections', 'provider_key'],
    ['connections', 'setup_state'],
    ['agent_nodes', 'connection_selector'],
  ]);
}

async function trigger_shape_schema_exists() {
  return columns_exist([
    ['triggers', 'trigger_source'],
    ['triggers', 'trigger_target'],
  ]);
}

async function channels_schema_exists() {
  return columns_exist([['channels', 'channel_id']]);
}

async function columns_exist(expected_columns: readonly (readonly [string, string])[]) {
  const column_rows = await client<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const existing_columns = new Set(
    column_rows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  return expected_columns.every(
    ([table_name, column_name]) => existing_columns.has(`${table_name}.${column_name}`),
  );
}

function hash_migration(sql: string) {
  return createHash('sha256').update(sql).digest('hex');
}

main().catch(async (error) => {
  console.error(`Migration failed from ${basename(migrations_directory)}:`, error);
  await client.end({ timeout: 1 }).catch(() => undefined);
  process.exit(1);
});
