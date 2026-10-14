import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { search_tool_catalog } from '@coworker/core/db/queries/catalog';
import { apps, nodes } from '@coworker/core/db/schema';
import {
  alfera_api_tool_groups,
  alfera_api_tools,
} from '@coworker/core/integrations/alfera_api_tools';
import { create_id, id_prefixes } from '@coworker/shared';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'test-app-catalogue-key';
});

describe('connection tools route', () => {
  it('returns every visible tool with its policy group', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_test_app(db);
    const app = create_app(db);
    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'composio' }),
    });
    const connection_id = (await create_response.json()).data.connection.connection_id as string;
    await db
      .insert(nodes)
      .values([
        test_node(app_row.app_id, 'read_email', 'Read email', 'none', 'visible'),
        test_node(app_row.app_id, 'send_email', 'Send email', 'manual_review', 'visible'),
        test_node(app_row.app_id, 'hidden_action', 'Hidden action', 'none', 'hidden'),
      ]);

    const response = await app.request(`/v1/connections/${connection_id}/tools`);
    const connection_response = await app.request(`/v1/connections/${connection_id}`);
    const body = await response.json();

    expect(create_response.status).toBe(201);
    expect(response.status).toBe(200);
    expect(connection_response.status).toBe(200);
    expect((await connection_response.json()).data.permissions).toEqual({
      can_use: true,
      can_manage: true,
      can_delete: true,
    });
    expect(body.data).toMatchObject([
      {
        node_display_name: 'Read email',
        policy_group: 'only_reads',
        policy_label_ids: ['only_reads', 'every_tool'],
        tool_group: null,
      },
      {
        node_display_name: 'Send email',
        policy_group: 'changes_things',
        policy_label_ids: ['changes_things', 'every_tool'],
        tool_group: null,
      },
    ]);
  });
});

describe('built-in Alfera API connection', () => {
  it('lists the API tools with their rules and refuses to be disconnected', async () => {
    const db = await create_test_database();
    const { workspace_id } = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const minted = await app.request('/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_name: 'ops', scopes: ['sessions.write'] }),
    });

    const listed = (await (await app.request('/v1/connections')).json()).data as Array<{
      connection_id: string;
      connection_name: string;
      connection_status: string;
      permissions: Record<string, boolean>;
    }>;
    const built_in = listed.find((connection) => connection.connection_status === 'built_in');
    const connection_id = built_in?.connection_id ?? '';
    const tools = (await (await app.request(`/v1/connections/${connection_id}/tools`)).json())
      .data as Array<{
      node_name: string;
      policy_group: string;
      tool_group: { group_key: string; title: string; description: string } | null;
    }>;
    const rules = (
      await (
        await app.request(`/v1/policies?scope_type=connection&scope_id=${connection_id}`)
      ).json()
    ).data as Array<{ resource_id: string; policy_mode: string }>;
    const revoked = await app.request(`/v1/connections/${connection_id}/revoke`, {
      method: 'POST',
    });
    const run_catalog = await search_tool_catalog(db, { workspace_id, query: 'automation' });

    expect(minted.status).toBe(201);
    expect(built_in).toMatchObject({
      connection_name: 'Alfera API',
      permissions: { can_use: true, can_manage: true, can_delete: false },
    });
    expect(tools.map((tool) => tool.node_name).sort()).toEqual(
      alfera_api_tools.map((tool) => tool.tool_name).sort(),
    );
    const family_keys = new Set<string>(alfera_api_tool_groups.map((group) => group.group_key));
    for (const tool of tools) {
      expect(family_keys.has(tool.tool_group?.group_key ?? ''), tool.node_name).toBe(true);
      expect(tool.tool_group?.title, tool.node_name).toBeTruthy();
      expect(tool.tool_group?.description, tool.node_name).toBeTruthy();
    }
    expect(tools.find((tool) => tool.node_name === 'create_session')?.tool_group).toMatchObject({
      group_key: 'sessions',
      title: 'Sessions',
      position: 0,
    });
    expect(tools.find((tool) => tool.node_name === 'get_session')?.policy_group).toBe('only_reads');
    expect(tools.find((tool) => tool.node_name === 'create_session')?.policy_group).toBe(
      'changes_things',
    );
    expect(rules.map((rule) => [rule.resource_id, rule.policy_mode]).sort()).toEqual([
      ['alfera_api-rename_workspace-1', 'ask'],
      ['alfera_api-update_agent-1', 'ask'],
    ]);
    expect(revoked.status).toBe(409);
    expect((await revoked.json()).error.code).toBe('connection_is_built_in');
    expect(run_catalog.filter((tool) => tool.app_name === 'alfera_api')).toEqual([]);
  });
});

async function insert_test_app(db: Awaited<ReturnType<typeof create_test_database>>) {
  const [app] = await db
    .insert(apps)
    .values({
      app_id: create_id(id_prefixes.app),
      app_name: 'connection_tools_test',
      app_key: 'connection_tools_test',
      catalog_scope: 'global',
      app_display_name: 'Connection tools test',
      auth_type: 'oauth2',
      app_status: 'active',
      display_config: {},
      metadata: {
        provider_configs: [
          {
            provider_key: 'composio',
            provider_config_key: 'composio:connection_tools_test',
            version: 1,
            status: 'active',
            provider_app_key: 'gmail',
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: 'composio:connection_tools_test:managed_oauth',
                version: 1,
                status: 'active',
                auth_method_key: 'composio_managed_auth',
                setup_strategy: { type: 'connect_token' },
                runtime_credential_strategy: { type: 'provider_account_reference' },
                default_scopes: [],
              },
            ],
          },
        ],
      },
      created_by: 'test',
      last_updated_by: 'test',
    })
    .returning();
  if (!app) throw new Error('App insert failed');
  return app;
}

function test_node(
  app_id: string,
  node_name: string,
  node_display_name: string,
  approval_mode: 'none' | 'manual_review',
  discovery_status: 'visible' | 'hidden',
): typeof nodes.$inferInsert {
  return {
    node_id: create_id(id_prefixes.node),
    app_id,
    app_key: 'connection_tools_test',
    node_name,
    catalog_scope: 'global',
    node_key: `connection_tools_test-${node_name}-1`,
    node_version: 1,
    node_display_name,
    node_kind: 'tool',
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object', properties: {} },
    approval_policy: { mode: approval_mode },
    runtime_handler: `composio.${node_name}`,
    node_runtime: 'native_tool',
    node_status: 'active',
    discovery_status,
    provider_key: 'composio',
    provider_config_key: 'composio:connection_tools_test',
    provider_config_version: 1,
    connection_profile_key: 'composio:connection_tools_test:managed_oauth',
    connection_profile_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: {},
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  };
}
