import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  get_app_by_name,
  get_visible_tool_catalog_entry,
  list_nodes,
} from '@coworker/core/db/queries/catalog';
import { apps, nodes } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

async function seed_global_nodes(
  db: Awaited<ReturnType<typeof create_test_database>>,
  count: number,
) {
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: 'catalog_app',
    app_key: 'catalog_app',
    catalog_scope: 'global',
    app_display_name: 'Catalog app',
    auth_type: 'none',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  });

  const rows: Array<typeof nodes.$inferInsert> = Array.from({ length: count }, (_, index) => {
    const node_name = `tool_${String(index).padStart(4, '0')}`;
    return {
      node_id: create_id(id_prefixes.node),
      app_id,
      app_key: 'catalog_app',
      node_name,
      catalog_scope: 'global' as const,
      node_key: `catalog_app-${node_name}-1`,
      node_version: 1,
      node_display_name: `Tool ${index}`,
      node_kind: 'tool' as const,
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: {} },
      approval_policy: { mode: 'none' },
      runtime_handler: `native.${node_name}`,
      node_runtime: 'native_tool' as const,
      node_status: 'active' as const,
      discovery_status: 'visible' as const,
      provider_key: 'native',
      provider_config_key: 'native:catalog_app',
      provider_config_version: 1,
      required_scopes: [],
      required_account_properties: [],
      node_config: {},
      metadata: {},
      created_by: 'test',
      last_updated_by: 'test',
    };
  });
  await db.insert(nodes).values(rows);
}

describe('list_nodes', () => {
  it('prefers an exact workspace app over a global app with the same name', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await db.insert(apps).values([
      catalog_app('app_global_duplicate', 'global'),
      {
        ...catalog_app('app_workspace_duplicate', 'workspace'),
        workspace_id: bootstrap.workspace_id,
      },
    ]);

    await expect(
      get_app_by_name(db, { workspace_id: bootstrap.workspace_id, app_name: 'duplicate' }),
    ).resolves.toMatchObject({ app_id: 'app_workspace_duplicate', app_key: 'duplicate' });
  });

  it('prefers an exact workspace node over a global node with the same key', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await db.insert(apps).values([
      catalog_app('app_global_duplicate', 'global'),
      {
        ...catalog_app('app_workspace_duplicate', 'workspace'),
        workspace_id: bootstrap.workspace_id,
      },
    ]);
    await db.insert(nodes).values([
      catalog_node('node_global_duplicate', 'app_global_duplicate', 'global'),
      {
        ...catalog_node('node_workspace_duplicate', 'app_workspace_duplicate', 'workspace'),
        workspace_id: bootstrap.workspace_id,
      },
    ]);

    await expect(
      get_visible_tool_catalog_entry(db, {
        workspace_id: bootstrap.workspace_id,
        node_key: 'duplicate-run-1',
      }),
    ).resolves.toMatchObject({
      node_id: 'node_workspace_duplicate',
      app_key: 'duplicate',
    });
  });

  it('caps the unfiltered list at the default limit instead of returning the whole catalog', async () => {
    const db = await create_test_database();
    await seed_global_nodes(db, 250);

    const result = await list_nodes(db);

    expect(result).toHaveLength(200);
  });

  it('respects an explicit limit', async () => {
    const db = await create_test_database();
    await seed_global_nodes(db, 250);

    const result = await list_nodes(db, { limit: 10 });

    expect(result).toHaveLength(10);
  });

  it('returns only the nodes matching the requested keys', async () => {
    const db = await create_test_database();
    await seed_global_nodes(db, 250);

    const result = await list_nodes(db, {
      keys: ['catalog_app-tool_0005-1', 'catalog_app-tool_0042-1'],
    });

    expect(result.map((node) => node.node_key).sort()).toEqual([
      'catalog_app-tool_0005-1',
      'catalog_app-tool_0042-1',
    ]);
  });
});

function catalog_app(
  app_id: string,
  catalog_scope: 'global' | 'workspace',
): typeof apps.$inferInsert {
  return {
    app_id,
    app_name: 'duplicate',
    app_key: 'duplicate',
    catalog_scope,
    app_display_name: 'Duplicate',
    auth_type: 'none',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  };
}

function catalog_node(
  node_id: string,
  app_id: string,
  catalog_scope: 'global' | 'workspace',
): typeof nodes.$inferInsert {
  return {
    node_id,
    app_id,
    app_key: 'duplicate',
    node_name: 'run',
    catalog_scope,
    node_key: 'duplicate-run-1',
    node_version: 1,
    node_display_name: 'Run',
    node_kind: 'tool',
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object', properties: {} },
    approval_policy: { mode: 'none' },
    runtime_handler: `${catalog_scope}.run`,
    node_runtime: 'native_tool' as const,
    node_status: 'active' as const,
    discovery_status: 'visible' as const,
    provider_key: catalog_scope === 'global' ? 'native' : 'mcp',
    provider_config_key: `${catalog_scope === 'global' ? 'native' : 'mcp'}:duplicate`,
    provider_config_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: {},
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  };
}
