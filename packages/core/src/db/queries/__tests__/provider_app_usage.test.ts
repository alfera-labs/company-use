import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { list_provider_app_usage } from '@coworker/core/db/queries/provider_app_usage';
import { agents, apps, connections, nodes, tool_calls } from '@coworker/core/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';

const workspace_id = 'ws_provider_app_usage';
const actor_id = 'system:test';

async function insert_provider_app(
  db: Database,
  input: {
    app_name: string;
    provider_app_slug: string;
    source: string;
    app_display_name?: string;
  },
) {
  await db.insert(apps).values({
    app_id: `app_${input.app_name}`,
    app_name: input.app_name,
    app_key: input.app_name,
    catalog_scope: 'global',
    app_display_name: input.app_display_name ?? input.app_name,
    auth_type: 'oauth2',
    app_status: 'active',
    metadata: {
      source: input.source,
      sourced_from: {
        provider: input.source,
        provider_app_slug: input.provider_app_slug,
      },
    },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

async function insert_provider_node(
  db: Database,
  input: { app_name: string; node_name: string; provider_key: string },
) {
  const node_key = `${input.app_name}-${input.node_name}-1`;
  await db.insert(nodes).values({
    node_id: `node_${input.app_name}_${input.node_name}`,
    app_id: `app_${input.app_name}`,
    app_key: input.app_name,
    node_name: input.node_name,
    catalog_scope: 'global',
    node_key,
    node_version: 1,
    node_display_name: input.node_name,
    node_kind: 'action',
    input_schema: { type: 'object', properties: {} },
    runtime_handler: `${input.provider_key}.${input.node_name}`,
    node_runtime: 'connected_app',
    provider_key: input.provider_key,
    provider_config_key: `${input.provider_key}:${input.app_name}`,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  return node_key;
}

describe('provider app usage', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
    await insert_provider_app(db, {
      app_name: 'gmail',
      provider_app_slug: 'gmail',
      source: 'custom_http',
      app_display_name: 'Gmail (Custom HTTP)',
    });
    await insert_provider_app(db, {
      app_name: 'dead_app',
      provider_app_slug: 'dead_app',
      source: 'custom_http',
    });
    await insert_provider_app(db, {
      app_name: 'slack',
      provider_app_slug: 'slack',
      source: 'connector_registry',
    });
  });

  it('counts connections, tool calls, and agent enabled tools per provider app', async () => {
    const node_key = await insert_provider_node(db, {
      app_name: 'gmail',
      node_name: 'send_email',
      provider_key: 'custom_http',
    });
    await insert_provider_node(db, {
      app_name: 'dead_app',
      node_name: 'list_rows',
      provider_key: 'custom_http',
    });
    await db.insert(connections).values({
      connection_id: 'conn_gmail',
      workspace_id,
      app_id: 'app_gmail',
      connection_key: 'gmail:main',
      connection_status: 'active',
      provider_key: 'custom_http',
      provider_config_key: 'custom_http:gmail',
      connection_profile_key: 'custom_http:gmail:managed_oauth',
      created_by: actor_id,
      last_updated_by: actor_id,
    });
    await db.insert(tool_calls).values({
      tool_call_id: 'call_gmail',
      workspace_id,
      session_id: 'sess_1',
      run_id: 'run_1',
      tool_name: node_key,
      node_version: 1,
      tool_status: 'completed',
      created_by: actor_id,
      last_updated_by: actor_id,
    });
    await db.insert(agents).values({
      agent_id: 'agent_main',
      workspace_id,
      agent_slug: 'main',
      agent_name: 'Main',
      agent_config: {
        enabled_nodes: [
          {
            node_key,
            provider_key: 'custom_http',
            status: 'enabled',
            connection_selector: { strategy: 'latest_active_matching_connection' },
            input_defaults: {},
            approval_policy_override: null,
          },
        ],
      },
      created_by: actor_id,
      last_updated_by: actor_id,
    });

    const usage = await list_provider_app_usage(db, { provider_key: 'custom_http' });

    expect(usage.map((row) => row.app_name)).toEqual(['dead_app', 'gmail']);
    expect(usage[1]).toEqual({
      app_id: 'app_gmail',
      app_name: 'gmail',
      app_display_name: 'Gmail (Custom HTTP)',
      provider_app_slug: 'gmail',
      connections: 1,
      active_connections: 1,
      tool_calls: 1,
      last_tool_call_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      enabled_node_refs: 1,
    });
    expect(usage[0]).toEqual({
      app_id: 'app_dead_app',
      app_name: 'dead_app',
      app_display_name: 'dead_app',
      provider_app_slug: 'dead_app',
      connections: 0,
      active_connections: 0,
      tool_calls: 0,
      last_tool_call_time: null,
      enabled_node_refs: 0,
    });
  });

  it('counts a bare node_key string in agent_config as an enabled tool', async () => {
    const node_key = await insert_provider_node(db, {
      app_name: 'gmail',
      node_name: 'send_email',
      provider_key: 'custom_http',
    });
    await db.insert(agents).values({
      agent_id: 'agent_legacy',
      workspace_id,
      agent_slug: 'legacy',
      agent_name: 'Legacy',
      agent_config: { enabled_nodes: [node_key] },
      created_by: actor_id,
      last_updated_by: actor_id,
    });

    const usage = await list_provider_app_usage(db, { provider_key: 'custom_http' });

    expect(usage.find((row) => row.app_name === 'gmail')?.enabled_node_refs).toBe(1);
  });

  it('does not count another provider connection or tool call', async () => {
    const node_key = await insert_provider_node(db, {
      app_name: 'gmail',
      node_name: 'send_email',
      provider_key: 'composio',
    });
    await db.insert(connections).values({
      connection_id: 'conn_gmail_native',
      workspace_id,
      app_id: 'app_gmail',
      connection_key: 'gmail:native',
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:gmail',
      connection_profile_key: 'native:gmail:default',
      created_by: actor_id,
      last_updated_by: actor_id,
    });
    await db.insert(tool_calls).values({
      tool_call_id: 'call_gmail_composio',
      workspace_id,
      session_id: 'sess_1',
      run_id: 'run_1',
      tool_name: node_key,
      tool_status: 'completed',
      created_by: actor_id,
      last_updated_by: actor_id,
    });

    const usage = await list_provider_app_usage(db, { provider_key: 'custom_http' });
    const gmail = usage.find((row) => row.app_name === 'gmail');

    expect(gmail).toMatchObject({ connections: 0, tool_calls: 0, enabled_node_refs: 0 });
    expect(usage.map((row) => row.app_name)).not.toContain('slack');
  });
});
