import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  read_composio_nodes_by_app,
  upsert_composio_app,
  upsert_composio_nodes,
} from '@coworker/core/db/queries/composio_catalog_writes';
import { apps, nodes } from '@coworker/core/db/schema';
import {
  type ComposioTool,
  composio_tool_schema,
  composio_toolkit_detail_schema,
} from '@coworker/core/integrations/composio_api_records';
import {
  build_composio_action_node_seed,
  build_composio_app_seed,
  build_composio_proxy_node_seeds,
  composio_node_name,
} from '@coworker/core/integrations/composio_catalog';
import { catalog_node_version_maximum, maximum_node_name_length } from '@coworker/shared';
import { beforeEach, describe, expect, it } from 'vitest';

const actor_id = 'system:test_composio_catalog_sync';

const attio_toolkit = composio_toolkit_detail_schema.parse({
  slug: 'attio',
  name: 'Attio',
  composio_managed_auth_schemes: ['OAUTH2'],
  base_url: 'https://api.attio.com/v2',
  auth_config_details: [
    {
      mode: 'OAUTH2',
      required_scopes: ['record_permission:read-write'],
      fields: {
        auth_config_creation: { required: [], optional: [] },
        connected_account_initiation: { required: [], optional: [] },
      },
    },
  ],
  meta: {
    description: 'A customizable workspace for relationships.',
    categories: [{ slug: 'crm', name: 'CRM' }],
    tools_count: 2,
    triggers_count: 0,
    version: '20260909_00',
  },
});

const notion_toolkit = composio_toolkit_detail_schema.parse({
  slug: 'notion',
  name: 'Notion',
  composio_managed_auth_schemes: [],
  auth_config_details: [
    {
      mode: 'OAUTH2',
      required_scopes: [],
      fields: {
        auth_config_creation: {
          required: [{ name: 'client_id' }, { name: 'client_secret' }],
          optional: [],
        },
        connected_account_initiation: { required: [], optional: [] },
      },
    },
  ],
  meta: { categories: [] },
});

const list_records_tool = composio_tool_schema.parse({
  slug: 'ATTIO_LIST_RECORDS',
  name: 'List records',
  description: 'List records of one object.',
  toolkit: { slug: 'attio', name: 'attio' },
  input_parameters: {
    type: 'object',
    required: ['object'],
    properties: { object: { type: 'string', title: 'Object' } },
  },
  output_parameters: { type: 'object', properties: { data: { type: 'object' } } },
  version: '20260909_00',
});

const assert_company_tool = composio_tool_schema.parse({
  slug: 'ATTIO_ASSERT_COMPANY',
  name: 'Assert company',
  toolkit: { slug: 'attio', name: 'attio' },
  input_parameters: { type: 'object', properties: {} },
  version: '20260909_00',
});

const create_page_tool = composio_tool_schema.parse({
  slug: 'NOTION_CREATE_PAGE',
  name: 'Create page',
  toolkit: { slug: 'notion', name: 'notion' },
  input_parameters: { type: 'object', properties: {} },
  version: '20260909_00',
});

function build_attio_seeds(app_name: string) {
  const app_seed = build_composio_app_seed({ toolkit: attio_toolkit, app_name });
  const maximum_length = maximum_node_name_length(app_name, catalog_node_version_maximum);
  const proxy_seeds = build_composio_proxy_node_seeds({
    toolkit: attio_toolkit,
    app_name,
    maximum_length,
  });
  const action_seeds = [list_records_tool, assert_company_tool].map((tool) =>
    build_composio_action_node_seed({
      toolkit: attio_toolkit,
      tool,
      app_name,
      node_name: composio_node_name(tool.slug, attio_toolkit.slug, maximum_length),
    }),
  );
  return { app_seed, node_seeds: [...proxy_seeds, ...action_seeds] };
}

async function insert_provider_node(
  db: Database,
  input: { app_id: string; app_name: string; node_name: string; provider_key: string },
) {
  const node_key = `${input.app_name}-${input.node_name}-1`;
  await db.insert(nodes).values({
    node_id: `node_${input.app_name}_${input.node_name}`,
    app_id: input.app_id,
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

describe('composio catalog writes', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
  });

  it('refuses to rebind an app_name another catalog owns', async () => {
    await db.insert(apps).values({
      app_id: 'app_native_attio',
      app_name: 'attio',
      app_key: 'attio',
      catalog_scope: 'global',
      app_display_name: 'Attio (native)',
      auth_type: 'oauth2',
      app_status: 'active',
      metadata: { source: 'connector_registry' },
      created_by: actor_id,
      last_updated_by: actor_id,
    });
    const { app_seed } = build_attio_seeds('attio');

    await expect(upsert_composio_app(db, { app_seed, actor_id })).rejects.toThrow(
      'Refusing to rebind app_name attio owned by connector_registry',
    );
    const [row] = await db.select().from(apps);
    expect(row?.app_display_name).toBe('Attio (native)');
  });

  it('writes every node once, then updates the same rows on a re-run', async () => {
    const { app_seed, node_seeds } = build_attio_seeds('attio');
    const created_app = await upsert_composio_app(db, { app_seed, actor_id });

    const first = await upsert_composio_nodes(db, {
      app_id: created_app.app_id,
      app_seed,
      node_seeds,
      actor_id,
    });
    const updated_app = await upsert_composio_app(db, { app_seed, actor_id });
    const second = await upsert_composio_nodes(db, {
      app_id: created_app.app_id,
      app_seed,
      node_seeds,
      actor_id,
    });

    expect(created_app.inserted).toBe(true);
    expect(updated_app).toEqual({ app_id: created_app.app_id, inserted: false });
    expect(first).toEqual({
      nodes_created: node_seeds.length,
      nodes_updated: 0,
      nodes_deleted: 0,
      empty_toolkit_refused: false,
      inactive_connection_profile: null,
    });
    expect(second).toEqual({
      nodes_created: 0,
      nodes_updated: node_seeds.length,
      nodes_deleted: 0,
      empty_toolkit_refused: false,
      inactive_connection_profile: null,
    });

    const written_nodes = await db.select().from(nodes);
    expect(written_nodes).toHaveLength(node_seeds.length);
    expect(written_nodes.map((node) => node.node_key)).toContain('attio-list_records-1');
    expect(written_nodes.every((node) => node.provider_key === 'composio')).toBe(true);
    expect(written_nodes.every((node) => node.app_id === created_app.app_id)).toBe(true);
  });

  it('writes the display name the caller names over the toolkit seed name', async () => {
    const { app_seed } = build_attio_seeds('attio_v2');

    await upsert_composio_app(db, { app_seed, app_display_name: 'Attio', actor_id });

    const [row] = await db.select().from(apps);
    expect(row).toMatchObject({ app_name: 'attio_v2', app_display_name: 'Attio' });
  });

  it('reports the disabled connection profile when a toolkit has no active one', async () => {
    const app_seed = build_composio_app_seed({ toolkit: notion_toolkit, app_name: 'notion' });
    const maximum_length = maximum_node_name_length('notion', catalog_node_version_maximum);
    const node_seeds = [
      build_composio_action_node_seed({
        toolkit: notion_toolkit,
        tool: create_page_tool,
        app_name: 'notion',
        node_name: composio_node_name(create_page_tool.slug, notion_toolkit.slug, maximum_length),
      }),
    ];
    const app_row = await upsert_composio_app(db, { app_seed, actor_id });

    const result = await upsert_composio_nodes(db, {
      app_id: app_row.app_id,
      app_seed,
      node_seeds,
      actor_id,
    });

    expect(result.inactive_connection_profile).toEqual({
      connection_profile_key: 'composio:notion:oauth2',
      disabled_reason: expect.stringContaining('custom auth config'),
    });
    const [node] = await db.select().from(nodes);
    expect(node?.connection_profile_key).toBe('composio:notion:oauth2');
  });
});

describe('composio node lifecycle', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
  });

  async function write_attio_nodes(app_id: string, tools: ComposioTool[]) {
    const app_seed = build_composio_app_seed({ toolkit: attio_toolkit, app_name: 'attio' });
    const maximum_length = maximum_node_name_length('attio', catalog_node_version_maximum);
    const node_seeds = [
      ...build_composio_proxy_node_seeds({
        toolkit: attio_toolkit,
        app_name: 'attio',
        maximum_length,
      }),
      ...tools.map((tool) =>
        build_composio_action_node_seed({
          toolkit: attio_toolkit,
          tool,
          app_name: 'attio',
          node_name: composio_node_name(tool.slug, attio_toolkit.slug, maximum_length),
        }),
      ),
    ];
    return upsert_composio_nodes(db, { app_id, app_seed, node_seeds, actor_id });
  }

  it('deletes the nodes a toolkit stopped offering and leaves the survivors alone', async () => {
    const app_seed = build_composio_app_seed({ toolkit: attio_toolkit, app_name: 'attio' });
    const { app_id } = await upsert_composio_app(db, { app_seed, actor_id });
    await write_attio_nodes(app_id, [list_records_tool, assert_company_tool]);
    const before = await db.select().from(nodes);
    const survivor = before.find((node) => node.node_name === 'list_records');

    const result = await write_attio_nodes(app_id, [list_records_tool]);

    expect(result.nodes_deleted).toBe(1);
    expect(result.empty_toolkit_refused).toBe(false);
    const after = await db.select().from(nodes);
    expect(after.map((node) => node.node_name)).not.toContain('assert_company');
    expect(after).toHaveLength(before.length - 1);
    const survived = after.find((node) => node.node_name === 'list_records');
    expect(survived?.node_id).toBe(survivor?.node_id);
    expect(survived?.node_key).toBe('attio-list_records-1');
  });

  it('keeps another provider\u2019s nodes on the same app row', async () => {
    const app_seed = build_composio_app_seed({ toolkit: attio_toolkit, app_name: 'attio' });
    const { app_id } = await upsert_composio_app(db, { app_seed, actor_id });
    await write_attio_nodes(app_id, [list_records_tool, assert_company_tool]);
    await insert_provider_node(db, {
      app_id,
      app_name: 'attio',
      node_name: 'native_list_records',
      provider_key: 'native',
    });

    const result = await write_attio_nodes(app_id, [list_records_tool]);

    expect(result.nodes_deleted).toBe(1);
    const remaining = await db.select().from(nodes);
    expect(remaining.map((node) => node.node_name)).toContain('native_list_records');
  });

  it('refuses to wipe an app whose toolkit answered nothing', async () => {
    const app_seed = build_composio_app_seed({ toolkit: attio_toolkit, app_name: 'attio' });
    const { app_id } = await upsert_composio_app(db, { app_seed, actor_id });
    await write_attio_nodes(app_id, [list_records_tool, assert_company_tool]);
    const before = await db.select().from(nodes);

    const result = await upsert_composio_nodes(db, {
      app_id,
      app_seed,
      node_seeds: [],
      actor_id,
    });

    expect(result).toMatchObject({
      nodes_created: 0,
      nodes_updated: 0,
      nodes_deleted: 0,
      empty_toolkit_refused: true,
    });
    const after = await db.select().from(nodes);
    expect(after.map((node) => node.node_name).sort()).toEqual(
      before.map((node) => node.node_name).sort(),
    );
  });

  it('writes every row across chunk boundaries and re-runs idempotently', async () => {
    const app_seed = build_composio_app_seed({ toolkit: attio_toolkit, app_name: 'attio' });
    const { app_id } = await upsert_composio_app(db, { app_seed, actor_id });
    const maximum_length = maximum_node_name_length('attio', catalog_node_version_maximum);
    const node_seeds = Array.from({ length: 1201 }, (_, index) =>
      build_composio_action_node_seed({
        toolkit: attio_toolkit,
        tool: composio_tool_schema.parse({
          slug: `ATTIO_BULK_TOOL_${index}`,
          name: `Bulk tool ${index}`,
          toolkit: { slug: 'attio', name: 'attio' },
          input_parameters: { type: 'object', properties: {} },
        }),
        app_name: 'attio',
        node_name: composio_node_name(`ATTIO_BULK_TOOL_${index}`, 'attio', maximum_length),
      }),
    );

    const first = await upsert_composio_nodes(db, { app_id, app_seed, node_seeds, actor_id });
    const second = await upsert_composio_nodes(db, { app_id, app_seed, node_seeds, actor_id });

    expect(first).toMatchObject({ nodes_created: 1201, nodes_updated: 0, nodes_deleted: 0 });
    expect(second).toMatchObject({ nodes_created: 0, nodes_updated: 1201, nodes_deleted: 0 });
    const written = await db.select().from(nodes);
    expect(written).toHaveLength(1201);
    expect(new Set(written.map((node) => node.node_name)).size).toBe(1201);
  });

  it('uses the preloaded rows the caller hands in', async () => {
    const app_seed = build_composio_app_seed({ toolkit: attio_toolkit, app_name: 'attio' });
    const { app_id } = await upsert_composio_app(db, { app_seed, actor_id });
    await write_attio_nodes(app_id, [list_records_tool, assert_company_tool]);
    const preloaded = await read_composio_nodes_by_app(db, [app_id]);
    const maximum_length = maximum_node_name_length('attio', catalog_node_version_maximum);

    const result = await upsert_composio_nodes(db, {
      app_id,
      app_seed,
      node_seeds: [
        build_composio_action_node_seed({
          toolkit: attio_toolkit,
          tool: list_records_tool,
          app_name: 'attio',
          node_name: composio_node_name(list_records_tool.slug, 'attio', maximum_length),
        }),
      ],
      actor_id,
      existing_nodes: preloaded.get(app_id) ?? [],
    });

    expect(result.nodes_updated).toBe(1);
    expect(result.nodes_deleted).toBe(6);
    expect(await db.select().from(nodes)).toHaveLength(1);
  });
});
