import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  list_apps,
  list_apps_by_normalized_keys,
  resolve_catalog_tool,
  search_apps,
  search_tool_catalog,
} from '@coworker/core/db/queries/catalog';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';

const actor_id = 'system:test_catalog_app_offer';
const workspace_id = 'ws_catalog_app_offer';
const other_workspace_id = 'ws_catalog_app_offer_other';

const old_app_id = 'app_google_drive';
const new_app_id = 'app_google_drive_v2';
const old_node_key = 'google_drive-list_files-1';
const new_node_key = 'google_drive_v2-list_files-1';

async function insert_app(
  db: Database,
  input: {
    app_id: string;
    app_name: string;
    app_display_name: string;
    app_status: string;
    superseded_by_app_name?: string;
  },
) {
  await db.insert(apps).values({
    app_id: input.app_id,
    app_name: input.app_name,
    app_key: input.app_name,
    catalog_scope: 'global',
    app_display_name: input.app_display_name,
    app_category: 'productivity',
    auth_type: 'oauth2',
    app_status: input.app_status,
    metadata: {
      source: input.superseded_by_app_name ? 'custom_http' : 'composio',
      ...(input.superseded_by_app_name
        ? { superseded_by_app_name: input.superseded_by_app_name }
        : {}),
    },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

async function insert_node(
  db: Database,
  input: { app_id: string; app_name: string; node_key: string; provider_key: string },
) {
  await db.insert(nodes).values({
    node_id: `node_${input.app_name}`,
    app_id: input.app_id,
    app_key: input.app_name,
    node_name: 'list_files',
    catalog_scope: 'global',
    node_key: input.node_key,
    node_version: 1,
    node_display_name: 'List files',
    node_kind: 'action',
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object', properties: {} },
    approval_policy: { mode: 'none' },
    runtime_handler: `${input.provider_key}.list_files`,
    node_runtime: 'connected_app',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: input.provider_key,
    provider_config_key: `${input.provider_key}:${input.app_name}`,
    provider_config_version: 1,
    connection_profile_key: `${input.provider_key}:${input.app_name}:managed_oauth`,
    connection_profile_version: 1,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

async function connect_old_app(db: Database, input: { workspace_id: string }) {
  await db.insert(connections).values({
    connection_id: `conn_${input.workspace_id}`,
    workspace_id: input.workspace_id,
    app_id: old_app_id,
    connection_key: `custom_http:google_drive:${input.workspace_id}`,
    connection_status: 'active',
    provider_key: 'custom_http',
    provider_config_key: 'custom_http:google_drive',
    provider_config_version: 1,
    connection_profile_key: 'custom_http:google_drive:managed_oauth',
    connection_profile_version: 1,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

describe('app offer condition', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
    await insert_app(db, {
      app_id: new_app_id,
      app_name: 'google_drive_v2',
      app_display_name: 'Google Drive',
      app_status: 'active',
    });
    await insert_app(db, {
      app_id: old_app_id,
      app_name: 'google_drive',
      app_display_name: 'Google Drive (legacy)',
      app_status: 'superseded',
      superseded_by_app_name: 'google_drive_v2',
    });
    await insert_node(db, {
      app_id: new_app_id,
      app_name: 'google_drive_v2',
      node_key: new_node_key,
      provider_key: 'composio',
    });
    await insert_node(db, {
      app_id: old_app_id,
      app_name: 'google_drive',
      node_key: old_node_key,
      provider_key: 'custom_http',
    });
  });

  it('offers only the new app to a workspace with no connection to the old one', async () => {
    const listed = await list_apps(db, workspace_id);
    const searched = await search_apps(db, { workspace_id, query: 'Google Drive' });
    const by_keys = await list_apps_by_normalized_keys(db, {
      keys: ['googledrive'],
      workspace_id,
    });
    const tools = await search_tool_catalog(db, { workspace_id, query: 'list files' });

    expect(listed.map((app) => app.app_name)).toEqual(['google_drive_v2']);
    expect(searched.items.map((app) => app.app_name)).toEqual(['google_drive_v2']);
    expect(searched.total).toBe(1);
    expect(by_keys.map((app) => app.app_name)).toEqual(['google_drive_v2']);
    expect(tools.map((tool) => tool.node_key)).toEqual([new_node_key]);
  });

  it('offers both rows to the workspace that still holds the old connection', async () => {
    await connect_old_app(db, { workspace_id });

    const listed = await list_apps(db, workspace_id);
    const searched = await search_apps(db, { workspace_id, query: 'Google Drive' });
    const by_keys = await list_apps_by_normalized_keys(db, {
      keys: ['googledrive'],
      workspace_id,
    });
    const tools = await search_tool_catalog(db, { workspace_id, query: 'list files' });

    expect(listed.map((app) => [app.app_name, app.app_display_name])).toEqual([
      ['google_drive', 'Google Drive (legacy)'],
      ['google_drive_v2', 'Google Drive'],
    ]);
    expect(searched.items.map((app) => app.app_display_name)).toEqual([
      'Google Drive (legacy)',
      'Google Drive',
    ]);
    expect(by_keys.map((app) => app.app_name)).toEqual(['google_drive_v2', 'google_drive']);
    expect(tools.map((tool) => tool.node_key)).toEqual([old_node_key, new_node_key]);
  });

  it('keeps the old app out of another workspace that never connected it', async () => {
    await connect_old_app(db, { workspace_id });

    const listed = await list_apps(db, other_workspace_id);
    const tools = await search_tool_catalog(db, {
      workspace_id: other_workspace_id,
      query: 'list files',
    });

    expect(listed.map((app) => app.app_name)).toEqual(['google_drive_v2']);
    expect(tools.map((tool) => tool.node_key)).toEqual([new_node_key]);
  });

  it('still resolves a tool of the old app for the workspace that connected it', async () => {
    await connect_old_app(db, { workspace_id });

    const resolution = await resolve_catalog_tool(db, {
      workspace_id,
      node_key: old_node_key,
    });

    expect(resolution.tool?.node_key).toBe(old_node_key);
    expect(resolution.connection?.connection_id).toBe(`conn_${workspace_id}`);
    expect(resolution.compatibility).toEqual({ ok: true });
  });
});
