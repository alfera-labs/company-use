import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { describe, expect, it } from 'vitest';

const migrations_directory = resolve(import.meta.dirname, '../migrations');

describe('model route compatibility migration', () => {
  it('normalizes existing agent pins, runs, and usage without replacing metadata', async () => {
    const client = new PGlite({ extensions: { vector } });
    await run_migrations_before_model_route_compatibility(client);
    await insert_existing_model_rows(client);
    await run_migration(client, '0040_model_route_compatibility.sql');

    const agents = await client.query<{
      agent_id: string;
      default_model: string | null;
      default_model_provider: string | null;
      agent_config: Record<string, unknown>;
    }>(
      `SELECT agent_id, default_model, default_model_provider, agent_config
       FROM agents
       WHERE agent_id LIKE 'agent_model_%'
       ORDER BY agent_id`,
    );
    expect(agents.rows).toEqual([
      {
        agent_id: 'agent_model_direct',
        default_model: 'gpt-5.5',
        default_model_provider: 'openai',
        agent_config: { model_proxy: 'openai_direct', preserved: true },
      },
      {
        agent_id: 'agent_model_gateway',
        default_model: 'anthropic/claude-opus-4.8',
        default_model_provider: 'anthropic',
        agent_config: { model_proxy: 'vercel_ai_gateway', preserved: true },
      },
      {
        agent_id: 'agent_model_implicit',
        default_model: null,
        default_model_provider: null,
        agent_config: {
          preserved: true,
          model_pin_cleared_by_migration_0040: {
            default_model: 'gpt-5.5',
            default_model_name: null,
            model_proxy: null,
          },
        },
      },
      {
        agent_id: 'agent_model_stale_gateway',
        default_model: 'claude-sonnet-5',
        default_model_provider: null,
        agent_config: { preserved: true },
      },
    ]);

    const run = await client.query<{
      model_provider: string;
      provider_name: string;
      run_metadata: Record<string, unknown>;
    }>(`SELECT model_provider, provider_name, run_metadata FROM runs WHERE run_id = 'run_model'`);
    expect(run.rows[0]).toEqual({
      model_provider: 'anthropic',
      provider_name: 'anthropic',
      run_metadata: { model_proxy: 'vercel_ai_gateway', preserved: true },
    });

    const usage = await client.query<{
      provider: string;
      provider_name: string;
      usage_metadata: Record<string, unknown>;
    }>(
      `SELECT provider, provider_name, usage_metadata
       FROM usage_records
       WHERE usage_record_id = 'usage_model'`,
    );
    expect(usage.rows[0]).toEqual({
      provider: 'anthropic',
      provider_name: 'anthropic',
      usage_metadata: { model_proxy: 'vercel_ai_gateway', preserved: true },
    });

    await client.close();
  });
});

async function run_migrations_before_model_route_compatibility(client: PGlite) {
  const migration_files = readdirSync(migrations_directory)
    .filter((file_name) => file_name.endsWith('.sql') && file_name < '0040_')
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

async function insert_existing_model_rows(client: PGlite) {
  await client.exec(`
    INSERT INTO agents (
      agent_id, workspace_id, agent_slug, agent_name, system_instructions, default_model,
      default_model_provider, default_model_name, agent_config, created_by, last_updated_by
    ) VALUES
      (
        'agent_model_gateway', 'workspace_model', 'gateway', 'Gateway agent', 'Test',
        'anthropic/claude-opus-4.8', 'ai_gateway', 'anthropic/claude-opus-4.8',
        '{"preserved":true}'::jsonb, 'test', 'test'
      ),
      (
        'agent_model_direct', 'workspace_model', 'direct', 'Direct agent', 'Test',
        'gpt-5.5', 'openai', 'gpt-5.5',
        '{"preserved":true}'::jsonb, 'test', 'test'
      ),
      (
        'agent_model_implicit', 'workspace_model', 'implicit', 'Implicit agent', 'Test',
        'gpt-5.5', NULL, NULL,
        '{"preserved":true}'::jsonb, 'test', 'test'
      ),
      (
        'agent_model_stale_gateway', 'workspace_model', 'stale', 'Stale gateway agent', 'Test',
        'claude-sonnet-5', 'ai_gateway', 'claude-sonnet-5',
        '{"preserved":true}'::jsonb, 'test', 'test'
      );

    INSERT INTO runs (
      run_id, workspace_id, session_id, agent_id, model_provider, provider_name, model_name,
      run_metadata, created_by, last_updated_by
    ) VALUES (
      'run_model', 'workspace_model', 'session_model', 'agent_model_gateway',
      'ai_gateway', 'ai_gateway', 'anthropic/claude-opus-4.8',
      '{"preserved":true}'::jsonb, 'test', 'test'
    );

    INSERT INTO usage_records (
      usage_record_id, workspace_id, run_id, usage_date, usage_kind, provider, provider_name,
      quantity, unit, usage_metadata, created_by, last_updated_by
    ) VALUES (
      'usage_model', 'workspace_model', 'run_model', CURRENT_DATE, 'llm_tokens',
      'ai_gateway', 'ai_gateway', 100, 'token',
      '{"preserved":true}'::jsonb, 'test', 'test'
    );
  `);
}
