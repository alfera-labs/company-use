import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_workspace_mcp_catalog } from '@coworker/core/db/queries/mcp_catalog';
import {
  record_mcp_sync_outcome,
  sync_workspace_mcp_catalog,
} from '@coworker/core/db/queries/mcp_catalog_sync';
import { apps, nodes } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const endpoint_url = 'https://mcp.example.test/mcp';

async function create_server(db: Awaited<ReturnType<typeof create_test_database>>) {
  const bootstrap = await bootstrap_default_workspace(db);
  const catalog = await create_workspace_mcp_catalog(db, {
    workspace_id: bootstrap.workspace_id,
    server_key: 'acme',
    server_name: 'Acme',
    transport_config: { type: 'streamable_http', url: endpoint_url },
    tools: [],
    actor_id: bootstrap.user_id,
  });
  return { bootstrap, catalog };
}

function sync_input(
  bootstrap: { workspace_id: string; user_id: string },
  catalog: { app_id: string; app_name: string },
  tools: { tool_name: string; display_name: string; input_schema?: Record<string, unknown> }[],
) {
  return {
    workspace_id: bootstrap.workspace_id,
    app_id: catalog.app_id,
    app_name: catalog.app_name,
    server_key: 'acme',
    endpoint_url,
    tools,
    actor_id: bootstrap.user_id,
  };
}

describe('MCP catalog sync', () => {
  it('inserts every tool on the first sync', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);

    const result = await sync_workspace_mcp_catalog(
      db,
      sync_input(bootstrap, catalog, [
        { tool_name: 'list_issues', display_name: 'List issues' },
        { tool_name: 'create_issue', display_name: 'Create issue' },
      ]),
    );

    expect(result.inserted_tool_names.sort()).toEqual(['create_issue', 'list_issues']);
    expect(result.retired_node_keys).toEqual([]);

    const rows = await db.select().from(nodes).where(eq(nodes.app_id, catalog.app_id));
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.node_runtime === 'mcp_tool')).toBe(true);
    expect(rows.every((row) => row.node_config.mcp?.endpoint_url === endpoint_url)).toBe(true);
  });

  it('does nothing at all when the tool list has not changed', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);
    const tools = [{ tool_name: 'list_issues', display_name: 'List issues' }];

    await sync_workspace_mcp_catalog(db, sync_input(bootstrap, catalog, tools));
    const before = await db.select().from(nodes).where(eq(nodes.app_id, catalog.app_id));

    const result = await sync_workspace_mcp_catalog(db, sync_input(bootstrap, catalog, tools));

    expect(result).toMatchObject({
      inserted_tool_names: [],
      updated_tool_names: [],
      retired_node_keys: [],
      unchanged_count: 1,
    });
    const after = await db.select().from(nodes).where(eq(nodes.app_id, catalog.app_id));
    expect(after[0]?.node_id).toBe(before[0]?.node_id);
    expect(after[0]?.last_updated_time).toEqual(before[0]?.last_updated_time);
  });

  it('retires a vanished tool and keeps its row and id', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);

    await sync_workspace_mcp_catalog(
      db,
      sync_input(bootstrap, catalog, [
        { tool_name: 'list_issues', display_name: 'List issues' },
        { tool_name: 'old_tool', display_name: 'Old tool' },
      ]),
    );
    const before = await db.query.nodes.findFirst({
      where: and(eq(nodes.app_id, catalog.app_id), eq(nodes.node_name, 'old_tool')),
    });

    const result = await sync_workspace_mcp_catalog(
      db,
      sync_input(bootstrap, catalog, [{ tool_name: 'list_issues', display_name: 'List issues' }]),
    );

    expect(result.retired_node_keys).toEqual([before?.node_key]);

    const after = await db.query.nodes.findFirst({
      where: and(eq(nodes.app_id, catalog.app_id), eq(nodes.node_name, 'old_tool')),
    });
    expect(after).toBeDefined();
    expect(after?.node_id).toBe(before?.node_id);
    expect(after?.node_status).toBe('retired');
    expect(after?.discovery_status).toBe('hidden');
  });

  it('brings a tool back when the server advertises it again', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);
    const tools = [{ tool_name: 'flaky_tool', display_name: 'Flaky' }];

    await sync_workspace_mcp_catalog(db, sync_input(bootstrap, catalog, tools));
    const original = await db.query.nodes.findFirst({
      where: eq(nodes.app_id, catalog.app_id),
    });
    await sync_workspace_mcp_catalog(db, sync_input(bootstrap, catalog, []));
    await sync_workspace_mcp_catalog(db, sync_input(bootstrap, catalog, tools));

    const revived = await db.query.nodes.findFirst({ where: eq(nodes.app_id, catalog.app_id) });
    expect(revived?.node_id).toBe(original?.node_id);
    expect(revived?.node_status).toBe('active');
    expect(revived?.discovery_status).toBe('visible');
  });

  it('updates a changed schema in place, keeping node_id and node_key', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);

    await sync_workspace_mcp_catalog(
      db,
      sync_input(bootstrap, catalog, [
        {
          tool_name: 'list_issues',
          display_name: 'List issues',
          input_schema: { type: 'object', properties: { team: { type: 'string' } } },
        },
      ]),
    );
    const before = await db.query.nodes.findFirst({ where: eq(nodes.app_id, catalog.app_id) });

    const result = await sync_workspace_mcp_catalog(
      db,
      sync_input(bootstrap, catalog, [
        {
          tool_name: 'list_issues',
          display_name: 'List issues',
          input_schema: {
            type: 'object',
            properties: { team: { type: 'string' }, state: { type: 'string' } },
          },
        },
      ]),
    );

    expect(result.updated_tool_names).toEqual(['list_issues']);
    const after = await db.query.nodes.findFirst({ where: eq(nodes.app_id, catalog.app_id) });
    expect(after?.node_id).toBe(before?.node_id);
    expect(after?.node_key).toBe(before?.node_key);
    expect(after?.node_version).toBe(before?.node_version);
    expect(after?.input_schema.properties).toHaveProperty('state');
  });

  it('gives a user-added server no exemption from review', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);

    await sync_workspace_mcp_catalog(db, {
      ...sync_input(bootstrap, catalog, [
        { tool_name: 'read_only_thing', display_name: 'Read only' },
      ]),
      tools: [
        {
          tool_name: 'read_only_thing',
          display_name: 'Read only',
          annotations: { read_only: true, destructive: null },
        },
      ],
    });

    const row = await db.query.nodes.findFirst({ where: eq(nodes.app_id, catalog.app_id) });
    expect(row?.approval_policy).toEqual({ mode: 'manual_review' });
  });

  it('records why a sync failed without touching the tools', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);
    await sync_workspace_mcp_catalog(
      db,
      sync_input(bootstrap, catalog, [{ tool_name: 'list_issues', display_name: 'List issues' }]),
    );

    await record_mcp_sync_outcome(db, {
      app_id: catalog.app_id,
      actor_id: bootstrap.user_id,
      last_error_message: 'Could not reach the MCP server: timeout',
    });

    const app = await db.query.apps.findFirst({ where: eq(apps.app_id, catalog.app_id) });
    expect(app?.metadata.mcp_sync?.last_error_message).toContain('timeout');
    const rows = await db.select().from(nodes).where(eq(nodes.app_id, catalog.app_id));
    expect(rows.every((row) => row.node_status === 'active')).toBe(true);
  });
});

describe('what a server says about itself', () => {
  it('replaces the slug with the name, icon and description the server sent', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);

    await record_mcp_sync_outcome(db, {
      app_id: catalog.app_id,
      actor_id: bootstrap.user_id,
      identity: {
        name: 'Context7',
        description: 'Up-to-date documentation for libraries and frameworks.',
        icon_url: 'https://context7.com/context7-icon-green.png',
      },
    });

    const app = await db.query.apps.findFirst({ where: eq(apps.app_id, catalog.app_id) });
    expect(app?.app_display_name).toBe('Context7');
    expect(app?.metadata.icon_url).toBe('https://context7.com/context7-icon-green.png');
    expect(app?.metadata.description).toContain('documentation');
    expect(app?.metadata.provider_configs?.[0]?.provider_key).toBe('mcp');
  });

  it('keeps the name a person typed, and still takes the icon and description', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const catalog = await create_workspace_mcp_catalog(db, {
      workspace_id: bootstrap.workspace_id,
      server_key: 'acme',
      server_name: 'Docs for the sales team',
      named_by_person: true,
      transport_config: { type: 'streamable_http', url: endpoint_url },
      tools: [],
      actor_id: bootstrap.user_id,
    });

    await record_mcp_sync_outcome(db, {
      app_id: catalog.app_id,
      actor_id: bootstrap.user_id,
      identity: { name: 'Context7', description: 'Documentation.', icon_url: null },
    });

    const app = await db.query.apps.findFirst({ where: eq(apps.app_id, catalog.app_id) });
    expect(app?.app_display_name).toBe('Docs for the sales team');
    expect(app?.metadata.description).toBe('Documentation.');
  });

  it('keeps the name already there when a server declines to name itself', async () => {
    const db = await create_test_database();
    const { bootstrap, catalog } = await create_server(db);

    await record_mcp_sync_outcome(db, {
      app_id: catalog.app_id,
      actor_id: bootstrap.user_id,
      identity: { name: null, description: null, icon_url: null },
    });

    const app = await db.query.apps.findFirst({ where: eq(apps.app_id, catalog.app_id) });
    expect(app?.app_display_name).toBe('Acme');
  });
});
