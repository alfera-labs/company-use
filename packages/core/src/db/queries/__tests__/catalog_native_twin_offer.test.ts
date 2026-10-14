import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { find_app_to_connect } from '@coworker/core/db/queries/app_to_connect';
import {
  list_apps_by_normalized_keys,
  list_nodes,
  search_apps,
} from '@coworker/core/db/queries/catalog';
import { list_app_ids_with_newer_connector } from '@coworker/core/db/queries/catalog_twin_offer';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';

const actor_id = 'system:test_catalog_native_twin_offer';
const workspace_id = 'ws_native_twin_offer';

async function insert_app(
  db: Database,
  input: { app_name: string; display_name: string; provider: 'native' | 'composio'; tools: number },
) {
  const app_id = `app_${input.app_name}`;
  await db.insert(apps).values({
    app_id,
    app_name: input.app_name,
    app_key: input.app_name,
    catalog_scope: 'global',
    app_display_name: input.display_name,
    app_category: 'communication',
    auth_type: 'oauth2',
    app_status: 'active',
    metadata: { sourced_from: { provider: input.provider } },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  for (let index = 0; index < input.tools; index += 1) {
    await db.insert(nodes).values({
      node_id: `node_${input.app_name}_${index}`,
      app_id,
      app_key: input.app_name,
      node_name: `tool_${index}`,
      catalog_scope: 'global',
      node_key: `${input.app_name}-tool_${index}-1`,
      node_version: 1,
      node_display_name: `Tool ${index}`,
      node_kind: 'action',
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: {} },
      approval_policy: { mode: 'none' },
      runtime_handler: `${input.provider}.tool_${index}`,
      node_runtime: 'connected_app',
      node_status: 'active',
      discovery_status: 'visible',
      provider_key: input.provider,
      provider_config_key: `${input.provider}:${input.app_name}`,
      provider_config_version: 1,
      connection_profile_key: `${input.provider}:${input.app_name}:oauth2`,
      connection_profile_version: 1,
      created_by: actor_id,
      last_updated_by: actor_id,
    });
  }
}

async function connect(db: Database, app_name: string) {
  await db.insert(connections).values({
    connection_id: `conn_${app_name}`,
    workspace_id,
    app_id: `app_${app_name}`,
    connection_key: `composio:${app_name}:${workspace_id}`,
    connection_status: 'active',
    provider_key: 'composio',
    provider_config_key: `composio:${app_name}`,
    provider_config_version: 1,
    connection_profile_key: `composio:${app_name}:oauth2`,
    connection_profile_version: 1,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

const names = (rows: { app_name: string }[]) => rows.map((row) => row.app_name).sort();

describe('an app we build ourselves beside its Composio twin', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
    await insert_app(db, {
      app_name: 'slack',
      display_name: 'Slack',
      provider: 'native',
      tools: 2,
    });
    await insert_app(db, {
      app_name: 'composio_slack',
      display_name: 'Slack',
      provider: 'composio',
      tools: 9,
    });
    await insert_app(db, {
      app_name: 'attio',
      display_name: 'Attio',
      provider: 'native',
      tools: 5,
    });
    await insert_app(db, {
      app_name: 'composio_attio',
      display_name: 'Attio',
      provider: 'composio',
      tools: 1,
    });
  });

  it('offers the Composio Attio and hides ours, on the tile, in search, and in tools', async () => {
    const tile = await list_apps_by_normalized_keys(db, { keys: ['attio'], workspace_id });
    const searched = await search_apps(db, { workspace_id, query: 'Attio' });
    const tools = await list_nodes(db, { workspace_id });

    expect(names(tile)).toEqual(['composio_attio']);
    expect(names(searched.items)).toEqual(['composio_attio']);
    expect(tools.map((tool) => tool.app_key).filter((key) => key.includes('attio'))).toEqual([
      'composio_attio',
    ]);
  });

  it('keeps our Slack and hides the Composio Slack', async () => {
    const searched = await search_apps(db, { workspace_id, query: 'Slack' });

    expect(names(searched.items)).toEqual(['slack']);
  });

  it('still shows our Attio to a workspace already connected to it, flagged as replaced', async () => {
    await connect(db, 'attio');

    const searched = await search_apps(db, { workspace_id, query: 'Attio' });
    const replaced = await list_app_ids_with_newer_connector(db, ['app_attio', 'app_slack']);

    expect(names(searched.items)).toEqual(['attio', 'composio_attio']);
    expect([...replaced]).toEqual(['app_attio']);
  });

  it('sends a new "attio" connection to Composio, even beside an old native connection', async () => {
    const fresh = await find_app_to_connect(db, { workspace_id, app_name: 'attio' });
    await connect(db, 'attio');
    const after_native = await find_app_to_connect(db, { workspace_id, app_name: 'attio' });
    const slack = await find_app_to_connect(db, { workspace_id, app_name: 'slack' });

    expect(fresh?.app_name).toBe('composio_attio');
    expect(after_native?.app_name).toBe('composio_attio');
    expect(slack?.app_name).toBe('slack');
  });
});
