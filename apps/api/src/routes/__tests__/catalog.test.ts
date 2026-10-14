import { create_app } from '@api/app';
import { seed_connector_catalog } from '@coworker/connectors';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, workspaces } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { find_why_app_cannot_connect_here } from '@runtime-platform/connections/app_connection_availability';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'test-app-catalogue-key';
});

describe('the catalog of an install with an app provider', () => {
  it('lists every connector, set up or not, as it always did', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    await seed_connector_catalog(db);
    const app = create_app(db);

    const search = await (await app.request('/v1/apps/search?limit=100')).json();
    const names = search.data.items.map((item: { app_name: string }) => item.app_name);

    expect(names).toContain('notion');
    expect(names).toContain('gmail');
    expect(search.data.total).toBe(names.length);
  });

  it('can connect an app that comes from the app catalogue', () => {
    const from_the_catalogue = {
      app_display_name: 'Notion',
      metadata: {
        provider_configs: [
          {
            provider_key: 'composio',
            provider_config_key: 'composio:notion',
            version: 1,
            status: 'active',
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: 'composio:notion:default',
                version: 1,
                status: 'active',
                auth_method_key: 'composio_managed_auth',
                setup_strategy: { type: 'connect_link' },
                runtime_credential_strategy: {},
                default_scopes: [],
              },
            ],
          },
        ],
      },
    };

    expect(find_why_app_cannot_connect_here(from_the_catalogue)).toBeNull();
  });
});

describe('catalog api routes', () => {
  it('serves only global active apps from the public catalog route', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    await insert_catalog_app(db, {
      app_name: 'global_slack',
      app_display_name: 'Global Slack',
      app_status: 'active',
    });
    await insert_catalog_app(db, {
      app_name: 'workspace_slack',
      app_display_name: 'Workspace Slack',
      app_status: 'active',
      catalog_scope: 'workspace',
      workspace_id: bootstrap.workspace_id,
    });
    await insert_catalog_app(db, {
      app_name: 'retired_slack',
      app_display_name: 'Retired Slack',
      app_status: 'retired',
    });

    const response = await app.request('/public/apps/search?q=slack');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.map((item: { app_name: string }) => item.app_name)).toEqual([
      'global_slack',
    ]);
    expect(body.data.total).toBe(1);
  });

  it.each([
    '/public/apps/search?limit=zero',
    '/public/apps/search?limit=-1',
    '/public/apps/search?offset=-1',
  ])('rejects an invalid public catalog query at the route boundary: %s', async (path) => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request(path);

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: 'validation_error',
      message: 'Request query failed validation',
    });
  });

  it('searches apps with server-side pagination and active app filtering', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    await insert_catalog_app(db, {
      app_name: 'slack',
      app_display_name: 'Slack',
      app_status: 'active',
    });
    await insert_catalog_app(db, {
      app_name: 'slack_workspace',
      app_display_name: 'Slack Workspace',
      app_status: 'active',
      catalog_scope: 'workspace',
      workspace_id: bootstrap.workspace_id,
    });
    await insert_catalog_app(db, {
      app_name: 'retired_slack',
      app_display_name: 'Retired Slack',
      app_status: 'retired',
    });

    const response = await app.request('/v1/apps/search?q=slack&limit=1');
    const body = await response.json();
    const next_response = await app.request(
      `/v1/apps/search?q=slack&limit=1&cursor=${body.data.next_cursor}`,
    );
    const next_body = await next_response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(2);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].app_display_name).toBe('Slack');
    expect(body.data.limit).toBe(1);
    expect(body.data.next_cursor).toEqual(expect.any(String));
    expect(next_response.status).toBe(200);
    expect(next_body.data.items).toHaveLength(1);
    expect(next_body.data.items[0].app_display_name).toBe('Slack Workspace');
    expect(next_body.data.next_cursor).toBeNull();
  });

  it('lists apps by normalized keys without returning the full catalog', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const other_workspace_id = await insert_workspace(db, {
      workspace_name: 'Other workspace',
      workspace_slug: 'other-workspace',
    });

    await insert_catalog_app(db, {
      app_name: 'google_sheets',
      app_display_name: 'Google Sheets',
      app_status: 'active',
      display_config: { icon_url: 'https://example.com/google-sheets.png' },
    });
    await insert_catalog_app(db, {
      app_name: 'hubspot',
      app_display_name: 'HubSpot',
      app_status: 'active',
      display_config: { icon_url: 'https://example.com/hubspot.png' },
    });
    await insert_catalog_app(db, {
      app_name: 'retired_slack',
      app_display_name: 'Retired Slack',
      app_status: 'retired',
    });
    await insert_catalog_app(db, {
      app_name: 'workspace_gmail',
      app_display_name: 'Gmail',
      app_status: 'active',
      catalog_scope: 'workspace',
      workspace_id: bootstrap.workspace_id,
    });
    await insert_catalog_app(db, {
      app_name: 'other_workspace_gmail',
      app_display_name: 'Gmail',
      app_status: 'active',
      catalog_scope: 'workspace',
      workspace_id: other_workspace_id,
    });

    await seed_connector_catalog(db);

    const response = await app.request(
      '/v1/apps/by-keys?keys=googlesheets,hubspot,retiredslack,gmail',
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((item: { app_name: string }) => item.app_name)).toEqual([
      'gmail',
      'google_sheets',
      'hubspot',
      'workspace_gmail',
    ]);
    expect(body.data[1].display_config.icon_url).toBe('https://example.com/google-sheets.png');
  });

  it('offers the Composio twin of our own connectors, and our own Slack', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);
    await seed_connector_catalog(db);
    const composio_twins = ['Attio', 'HubSpot', 'Notion', 'GitHub', 'Slack'];
    await Promise.all(
      composio_twins.map((display_name) =>
        insert_catalog_app(db, {
          app_name: `composio_${display_name.toLowerCase()}`,
          app_display_name: display_name,
          app_status: 'active',
          metadata: { sourced_from: { provider: 'composio' } },
        }),
      ),
    );

    const response = await app.request('/v1/apps/by-keys?keys=attio,hubspot,notion,github,slack');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.map(
        (item: { app_name: string; metadata: { sourced_from?: { provider: string } } }) => [
          item.app_name,
          item.metadata.sourced_from?.provider,
        ],
      ),
    ).toEqual([
      ['composio_attio', 'composio'],
      ['composio_github', 'composio'],
      ['composio_hubspot', 'composio'],
      ['composio_notion', 'composio'],
      ['slack', 'native'],
    ]);
  });
});

async function insert_workspace(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: { workspace_name: string; workspace_slug: string },
) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: input.workspace_name,
      workspace_slug: input.workspace_slug,
      workspace_status: 'active',
      created_by: 'test',
      last_updated_by: 'test',
    })
    .returning({ workspace_id: workspaces.workspace_id });
  if (!workspace) throw new Error('Workspace insert did not return a row');
  return workspace.workspace_id;
}

async function insert_catalog_app(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: {
    app_name: string;
    app_display_name: string;
    app_status: string;
    catalog_scope?: string | undefined;
    display_config?: Record<string, unknown> | undefined;
    workspace_id?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  },
) {
  await db.insert(apps).values({
    app_id: create_id(id_prefixes.app),
    app_name: input.app_name,
    app_key: input.app_name,
    catalog_scope: input.catalog_scope ?? 'global',
    workspace_id: input.workspace_id,
    app_display_name: input.app_display_name,
    auth_type: 'oauth2',
    app_status: input.app_status,
    display_config: input.display_config ?? {},
    metadata: input.metadata ?? {},
    created_by: 'test',
    last_updated_by: 'test',
  });
}
