import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { describe, expect, it } from 'vitest';

const migrations_directory = resolve(import.meta.dirname, '../migrations');

describe('node identity migration', () => {
  it('assigns stable distinct identities to lossy legacy MCP names', async () => {
    const client = new PGlite({ extensions: { vector } });
    await run_migrations_before_node_identity(client);
    await insert_legacy_mcp_catalog(client);
    await run_migration(client, '0032_node_identity_and_provenance.sql');

    const app = await client.query<{ app_name: string }>(
      "SELECT app_name FROM apps WHERE app_id = 'app_mcp_unsafe'",
    );
    expect(app.rows[0]?.app_name).toMatch(/^mcp_my_server_[a-f0-9]{8}$/u);
    expect(app.rows[0]?.app_name).toHaveLength(22);

    const nodes = await client.query<{ node_name: string; node_key: string }>(`
      SELECT node_name, node_key
      FROM nodes
      WHERE app_id = 'app_mcp_unsafe'
      ORDER BY node_id
    `);
    expect(nodes.rows.map((node) => node.node_name)).toEqual([
      expect.stringMatching(/^foo_bar_[a-f0-9]{8}$/u),
      expect.stringMatching(/^foo_bar_[a-f0-9]{8}$/u),
    ]);
    expect(new Set(nodes.rows.map((node) => node.node_name)).size).toBe(2);
    expect(nodes.rows.every((node) => node.node_key.length <= 64)).toBe(true);

    await client.close();
  });

  it('rejects orphan nodes instead of letting inner joins hide them', async () => {
    const client = new PGlite({ extensions: { vector } });
    await run_migrations_before_node_identity(client);
    await insert_legacy_orphan_node(client);

    await expect(run_migration(client, '0032_node_identity_and_provenance.sql')).rejects.toThrow(
      'nodes contain orphan app_id values',
    );

    await client.close();
  });
});

async function run_migrations_before_node_identity(client: PGlite) {
  const migration_files = readdirSync(migrations_directory)
    .filter((file_name) => file_name.endsWith('.sql') && file_name < '0032_')
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

async function insert_legacy_mcp_catalog(client: PGlite) {
  await client.exec(`
    INSERT INTO apps (
      app_id, app_slug, app_key, catalog_scope, workspace_id, app_name, app_category,
      auth_type, app_status, display_config, metadata, created_by, last_updated_by
    ) VALUES (
      'app_mcp_unsafe', 'mcp-My.Server', 'mcp:My.Server', 'workspace', 'ws_mcp',
      'My MCP server', 'mcp', 'none', 'active', '{}'::jsonb,
      '{"source":"mcp","sourced_from":{"provider":"mcp","provider_app_id":"mcp:My.Server"}}'::jsonb,
      'system:test', 'system:test'
    );

    INSERT INTO nodes (
      node_id, app_id, node_slug, catalog_scope, workspace_id, node_key, capability_key,
      node_family_key, node_version, node_name, node_kind, input_schema,
      runtime_handler, provider_key, provider_node_key, node_config, metadata,
      created_by, last_updated_by
    ) VALUES
      (
        'node_mcp_hyphen', 'app_mcp_unsafe', 'foo-bar', 'workspace', 'ws_mcp',
        'mcp:My.Server/foo-bar@1', 'mcp/foo-bar', 'mcp:My.Server/foo-bar', 1,
        'Foo hyphen', 'tool', '{}'::jsonb, 'mcp.My.Server.foo-bar', 'mcp',
        'foo-bar', '{}'::jsonb, '{"source":"mcp","tool_id":"foo-bar"}'::jsonb,
        'system:test', 'system:test'
      ),
      (
        'node_mcp_underscore', 'app_mcp_unsafe', 'foo_bar', 'workspace', 'ws_mcp',
        'mcp:My.Server/foo_bar@1', 'mcp/foo_bar', 'mcp:My.Server/foo_bar', 1,
        'Foo underscore', 'tool', '{}'::jsonb, 'mcp.My.Server.foo_bar', 'mcp',
        'foo_bar', '{}'::jsonb, '{"source":"mcp","tool_id":"foo_bar"}'::jsonb,
        'system:test', 'system:test'
      );
  `);
}

async function insert_legacy_orphan_node(client: PGlite) {
  await client.exec(`
    INSERT INTO nodes (
      node_id, app_id, node_slug, catalog_scope, node_key, capability_key,
      node_family_key, node_version, node_name, node_kind, input_schema,
      runtime_handler, provider_key, provider_node_key, node_config, metadata,
      created_by, last_updated_by
    ) VALUES (
      'node_orphan', 'app_missing', 'orphan', 'global', 'native:missing/orphan@1',
      'missing/orphan', 'native:missing/orphan', 1, 'Orphan', 'tool', '{}'::jsonb,
      'missing.orphan', 'native', 'missing.orphan', '{}'::jsonb, '{}'::jsonb,
      'system:test', 'system:test'
    );
  `);
}
