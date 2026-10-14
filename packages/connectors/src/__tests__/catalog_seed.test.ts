import { seed_connector_catalog, seed_connector_catalog_entries } from '@connectors/catalog_seed';
import { load_connector_node } from '@connectors/load_definition';
import type { ConnectorApp, RegisteredConnectorNode } from '@connectors/types';
import { apps, nodes } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const demo_app: ConnectorApp = {
  app_key: 'demo_crm',
  display_name: 'Demo CRM',
  base_url: 'https://api.demo-crm.invalid/v2',
  rate_limits: { rpm: 120, concurrency: 4, burst: 8 },
  auth: {
    kind: 'oauth2',
    auth_url: 'https://demo-crm.invalid/oauth/authorize',
    token_url: 'https://demo-crm.invalid/oauth/token',
    scopes: ['records.read', 'records.write'],
  },
};

const demo_node: RegisteredConnectorNode = {
  node_key: 'demo_crm-list_records-1',
  app_key: 'demo_crm',
  node_name: 'list_records',
  node_version: 1,
  app: demo_app,
  source_path: 'apps/demo_crm/list_records/v1/node.json',
  node: load_connector_node(
    'apps/demo_crm/list_records/v1/node.json',
    {
      node_key: 'demo_crm-list_records-1',
      display_name: 'List Records',
      description: 'List CRM records matching the filters.',
      implementation: 'execute',
      input_schema: {
        type: 'object',
        properties: {
          filters: { type: 'array', items: { type: 'string' } },
          cursor: { type: 'string' },
        },
        required: ['filters'],
      },
      output_schema: {
        type: 'object',
        properties: {
          records: { type: 'array', items: { type: 'string' } },
          next_cursor: { type: ['string', 'null'] },
        },
        required: ['records', 'next_cursor'],
      },
    },
    { execute: async () => ({ records: [], next_cursor: null }) },
  ),
};

describe('seed_connector_catalog', () => {
  it('writes the app and node rows the runtime catalog reads', async () => {
    const db = await create_test_database();

    await seed_connector_catalog_entries(db, [demo_app], [demo_node]);

    const app_row = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_crm') });
    expect(app_row).toMatchObject({
      app_name: 'demo_crm',
      app_key: 'demo_crm',
      catalog_scope: 'global',
      app_display_name: 'Demo CRM',
      app_category: 'connectors',
      auth_type: 'oauth2',
      app_status: 'active',
    });
    expect(app_row?.allowed_request_origins).toEqual(['https://api.demo-crm.invalid']);

    const node_row = await db.query.nodes.findFirst({
      where: eq(nodes.node_key, 'demo_crm-list_records-1'),
    });
    expect(node_row).toMatchObject({
      app_id: app_row?.app_id,
      app_key: 'demo_crm',
      node_name: 'list_records',
      node_version: 1,
      node_display_name: 'List Records',
      node_kind: 'tool',
      node_runtime: 'connected_app',
      node_status: 'active',
      discovery_status: 'visible',
      provider_key: 'native',
      provider_config_key: 'native:demo_crm',
      connection_profile_key: 'native:demo_crm:default',
      connection_profile_version: 1,
      runtime_handler: 'connectors.demo_crm-list_records-1',
    });
    expect(node_row?.required_scopes).toEqual(['records.read', 'records.write']);
    expect(node_row?.input_schema.required).toEqual(['filters']);
    expect(node_row?.metadata.description).toBe('List CRM records matching the filters.');
  });

  it('carries an api_key app into the catalog with no authorize url', async () => {
    const db = await create_test_database();
    const key_app: ConnectorApp = {
      ...demo_app,
      app_key: 'demo_keyed',
      auth: { kind: 'api_key', scopes: ['notes.read'] },
    };

    await seed_connector_catalog_entries(db, [key_app], []);

    const app_row = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_keyed') });
    expect(app_row?.auth_type).toBe('api_key');
    const [profile] = app_row?.metadata.provider_configs?.[0]?.connection_profiles ?? [];
    expect(profile?.auth_method_key).toBe('api_key');
    expect(profile?.setup_strategy).toEqual({});
    expect(profile?.default_scopes).toEqual(['notes.read']);
  });

  it('gives a real oauth connector the setup its first-party OAuth path needs', async () => {
    const db = await create_test_database();

    await seed_connector_catalog(db);

    const notion_app = await db.query.apps.findFirst({ where: eq(apps.app_name, 'notion') });
    const [notion_profile] = notion_app?.metadata.provider_configs?.[0]?.connection_profiles ?? [];
    expect(notion_profile?.auth_method_key).toBe('oauth2_authorization_code');
    expect(notion_profile?.setup_strategy).toEqual({
      type: 'oauth2_authorization_code',
      authorization_url: 'https://api.notion.com/v1/oauth/authorize',
      token_url: 'https://api.notion.com/v1/oauth/token',
      client_id_env: 'CONNECTOR_NOTION_CLIENT_ID',
      client_secret_env: 'CONNECTOR_NOTION_CLIENT_SECRET',
      scopes: [],
      authorization_params: { owner: 'user' },
      token_auth_method: 'client_secret_basic',
      token_request_format: 'json',
      scope_separator: 'space',
      use_pkce: false,
    });

    const hubspot_app = await db.query.apps.findFirst({ where: eq(apps.app_name, 'hubspot') });
    const [hubspot_profile] =
      hubspot_app?.metadata.provider_configs?.[0]?.connection_profiles ?? [];
    expect(hubspot_profile?.setup_strategy).toMatchObject({
      type: 'oauth2_authorization_code',
      authorization_url: 'https://app.hubspot.com/oauth/authorize',
      token_url: 'https://api.hubapi.com/oauth/v1/token',
      client_id_env: 'CONNECTOR_HUBSPOT_CLIENT_ID',
      client_secret_env: 'CONNECTOR_HUBSPOT_CLIENT_SECRET',
      token_auth_method: 'client_secret_post',
      token_request_format: 'form',
      scope_separator: 'space',
      use_pkce: false,
    });
    expect(hubspot_profile?.setup_strategy.authorization_params).toEqual({
      optional_scope: 'crm.schemas.custom.read',
    });
    expect(hubspot_profile?.setup_strategy.scopes).toContain('crm.objects.contacts.read');
    expect(hubspot_profile?.setup_strategy.scopes).not.toContain('crm.schemas.custom.read');
  });

  it('updates the same rows on a second seed instead of duplicating them', async () => {
    const db = await create_test_database();

    await seed_connector_catalog_entries(db, [demo_app], [demo_node]);
    await seed_connector_catalog_entries(
      db,
      [{ ...demo_app, display_name: 'Demo CRM (renamed)' }],
      [demo_node],
    );

    const app_rows = await db.select().from(apps).where(eq(apps.app_name, 'demo_crm'));
    const node_rows = await db
      .select()
      .from(nodes)
      .where(eq(nodes.node_key, 'demo_crm-list_records-1'));
    expect(app_rows).toHaveLength(1);
    expect(node_rows).toHaveLength(1);
    expect(app_rows[0]?.app_display_name).toBe('Demo CRM (renamed)');
  });

  describe('an app row another catalog already owns', () => {
    const composio_row: typeof apps.$inferInsert = {
      app_id: 'app_composio_demo',
      app_name: 'demo_crm',
      app_key: 'demo_crm',
      app_display_name: 'Demo CRM (Composio)',
      catalog_scope: 'global',
      created_by: 'system:test',
      last_updated_by: 'system:test',
      metadata: {
        source: 'composio',
        provider_configs: [
          {
            provider_key: 'composio',
            provider_config_key: 'composio:demo_crm',
            version: 1,
            status: 'active' as const,
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: 'composio:demo_crm:managed_oauth',
                auth_method_key: 'composio_managed_auth',
                version: 1,
                status: 'active' as const,
                setup_strategy: {},
                runtime_credential_strategy: {},
                default_scopes: [],
              },
            ],
          },
        ],
      },
    };

    it('adds the native way to connect beside the one already there, native last', async () => {
      const db = await create_test_database();
      await db.insert(apps).values(composio_row);

      await seed_connector_catalog_entries(db, [demo_app], [demo_node]);

      const row = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_crm') });
      expect(row?.metadata.provider_configs?.map((config) => config.provider_key)).toEqual([
        'composio',
        'native',
      ]);
      const native = row?.metadata.provider_configs?.at(-1);
      expect(native?.connection_profiles?.[0]?.setup_strategy).toMatchObject({
        type: 'oauth2_authorization_code',
        client_id_env: 'CONNECTOR_DEMO_CRM_CLIENT_ID',
        authorization_url: 'https://demo-crm.invalid/oauth/authorize',
      });
    });

    it('leaves the owning catalog its row, its name and its nodes', async () => {
      const db = await create_test_database();
      await db.insert(apps).values(composio_row);

      await seed_connector_catalog_entries(db, [demo_app], [demo_node]);

      const row = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_crm') });
      expect(row?.metadata.source).toBe('composio');
      expect(row?.app_display_name).toBe('Demo CRM (Composio)');
      const node_rows = await db.select().from(nodes).where(eq(nodes.app_id, 'app_composio_demo'));
      expect(node_rows).toHaveLength(0);
    });

    it('replaces its own entry on a second seed instead of stacking', async () => {
      const db = await create_test_database();
      await db.insert(apps).values(composio_row);

      await seed_connector_catalog_entries(db, [demo_app], [demo_node]);
      await seed_connector_catalog_entries(db, [demo_app], [demo_node]);

      const row = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_crm') });
      expect(row?.metadata.provider_configs?.map((config) => config.provider_key)).toEqual([
        'composio',
        'native',
      ]);
    });

    it('never replaces a same-key native config it does not own', async () => {
      const db = await create_test_database();
      const first_party_profile = {
        connection_profile_key: 'native:demo_crm:oauth_bot',
        auth_method_key: 'demo_oauth2_bot',
        version: 1,
        status: 'active' as const,
        setup_strategy: { type: 'first_party' },
        runtime_credential_strategy: {},
        default_scopes: [],
      };
      await db.insert(apps).values({
        ...composio_row,
        metadata: {
          source: 'runtime_tool_catalog',
          provider_configs: [
            {
              provider_key: 'native',
              provider_config_key: 'native:demo_crm',
              version: 1,
              status: 'active' as const,
              setup_defaults: {},
              connection_profiles: [first_party_profile],
            },
          ],
        },
      });

      await seed_connector_catalog_entries(db, [demo_app], [demo_node]);

      const row = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_crm') });
      expect(row?.metadata.provider_configs).toHaveLength(1);
      expect(row?.metadata.provider_configs?.[0]?.connection_profiles?.[0]).toMatchObject({
        connection_profile_key: 'native:demo_crm:oauth_bot',
      });
    });
  });

  describe('a held app on a foreign row', () => {
    const held_app: ConnectorApp = {
      ...demo_app,
      availability: { status: 'held', reason: 'Vendor has not approved the scopes yet.' },
    };
    const foreign_row: typeof apps.$inferInsert = {
      app_id: 'app_composio_held',
      app_name: 'demo_crm',
      app_key: 'demo_crm',
      app_display_name: 'Demo CRM',
      catalog_scope: 'global',
      created_by: 'system:test',
      last_updated_by: 'system:test',
      metadata: { source: 'composio', provider_configs: [] },
    };

    it('never takes a native config while held', async () => {
      const db = await create_test_database();
      await db.insert(apps).values(foreign_row);

      await seed_connector_catalog_entries(db, [held_app], []);

      const row = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_crm') });
      expect(row?.metadata.provider_configs ?? []).toHaveLength(0);
    });

    it('takes back a native config added before the hold', async () => {
      const db = await create_test_database();
      await db.insert(apps).values(foreign_row);
      await seed_connector_catalog_entries(db, [demo_app], []);
      const seeded = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_crm') });
      expect(seeded?.metadata.provider_configs?.map((config) => config.provider_key)).toEqual([
        'native',
      ]);

      await seed_connector_catalog_entries(db, [held_app], []);

      const healed = await db.query.apps.findFirst({ where: eq(apps.app_name, 'demo_crm') });
      expect(healed?.metadata.provider_configs ?? []).toHaveLength(0);
    });
  });

  it('keeps a hidden app out of the catalog', async () => {
    const db = await create_test_database();

    await seed_connector_catalog(db);

    const example_app = await db.query.apps.findFirst({ where: eq(apps.app_name, 'example') });
    const example_node = await db.query.nodes.findFirst({
      where: eq(nodes.node_key, 'example-echo_items-1'),
    });
    expect(example_app).toBeUndefined();
    expect(example_node).toBeUndefined();
  });
});
