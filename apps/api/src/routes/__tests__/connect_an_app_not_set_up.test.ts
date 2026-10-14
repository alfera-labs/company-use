import { create_app } from '@api/app';
import { seed_connector_catalog } from '@coworker/connectors';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { register_alfera_api_catalog } from '@coworker/core/db/queries/alfera_api_connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, connections } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@coworker/runtime-platform';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let notion_app_id: string;

beforeEach(async () => {
  db = await create_test_database();
  await bootstrap_default_workspace(db);
  await seed_connector_catalog(db);
  app = create_app(db);
  const [notion] = await db.select().from(apps).where(eq(apps.app_name, 'notion'));
  notion_app_id = notion?.app_id ?? '';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function connect_notion() {
  const response = await app.request('/v1/connections', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: notion_app_id, access_type: 'shared' }),
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      data?: { start_url: string | null };
      error?: { code: string; message: string };
    },
  };
}

async function connections_the_page_lists() {
  const response = await app.request('/v1/connections');
  const body = (await response.json()) as { data: { connection_status: string }[] };
  return body.data.map((connection) => connection.connection_status);
}

async function app_names_the_catalog_offers() {
  const search = await (await app.request('/v1/apps/search?limit=100')).json();
  const by_keys = await (await app.request('/v1/apps/by-keys?keys=notion,gmail,slack')).json();
  return {
    search: search.data.items.map((item: { app_name: string }) => item.app_name),
    total: search.data.total,
    by_keys: by_keys.data.map((item: { app_name: string }) => item.app_name),
  };
}

describe('the catalog of an install with no app provider', () => {
  it('lists no connector whose OAuth client is not set, no held one, no tool with nothing to connect', async () => {
    await seed_runtime_tool_catalog(db);

    const offered = await app_names_the_catalog_offers();

    const must_not_be_listed = ['notion', 'hubspot', 'github', 'attio', 'salesforce', 'slack'];
    expect(offered.search.filter((name: string) => must_not_be_listed.includes(name))).toEqual([]);
    expect(offered.search).not.toContain('gmail');
    expect(offered.search).not.toContain('math');
    expect(offered.total).toBe(offered.search.length);
    expect(offered.by_keys).toEqual([]);
  });

  it('lists a connector once its OAuth client is set, and still no held one', async () => {
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_ID', 'client');
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_SECRET', 'secret');
    vi.stubEnv('CONNECTOR_GMAIL_CLIENT_ID', 'client');
    vi.stubEnv('CONNECTOR_GMAIL_CLIENT_SECRET', 'secret');

    const offered = await app_names_the_catalog_offers();

    expect(offered.search).toContain('notion');
    expect(offered.search).not.toContain('gmail');
    expect(offered.by_keys).toEqual(['notion']);
  });
});

describe('an app whose setup could never finish', () => {
  async function start_a_connection(app_name: string) {
    const [row] = await db.select().from(apps).where(eq(apps.app_name, app_name));
    const response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: row?.app_id, access_type: 'shared' }),
    });
    const body = (await response.json()) as { error?: { code: string; message: string } };
    return { status: response.status, error: body.error };
  }

  it('is not offered: an app that connects with a key the dashboard has no field for', async () => {
    const offered = await app_names_the_catalog_offers();

    expect(offered.search).not.toContain('granola');
    expect(await start_a_connection('granola')).toEqual({
      status: 422,
      error: {
        code: 'app_not_set_up',
        message:
          'Granola is not set up on this deployment: it connects with an API key, and there is no place to enter that key yet.',
      },
    });
    expect(await connections_the_page_lists()).toEqual([]);
  });

  it('is not offered: the built-in API, which has no account to connect', async () => {
    await register_alfera_api_catalog(db);

    const offered = await app_names_the_catalog_offers();

    expect(offered.search).not.toContain('alfera_api');
    expect(await start_a_connection('alfera_api')).toEqual({
      status: 422,
      error: {
        code: 'app_not_set_up',
        message: 'Alfera API is built in: there is no account to connect.',
      },
    });
    expect(await connections_the_page_lists()).toEqual([]);
  });
});

describe('connecting an app this install has not set up', () => {
  it('says what is missing in one sentence and leaves no pending connection', async () => {
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_ID', '');
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_SECRET', '');

    const refused = await connect_notion();

    expect(refused.status).toBe(422);
    expect(refused.body.error).toEqual({
      code: 'app_not_set_up',
      message:
        'Notion is not set up on this deployment: its OAuth client (CONNECTOR_NOTION_CLIENT_ID and CONNECTOR_NOTION_CLIENT_SECRET) is missing.',
    });
    expect(
      await db.select().from(connections).where(eq(connections.app_id, notion_app_id)),
    ).toEqual([]);
    expect(await connections_the_page_lists()).not.toContain('pending_setup');
  });

  it('says the same for Slack, and starts no Slack setup', async () => {
    vi.stubEnv('SLACK_CLIENT_ID', '');
    vi.stubEnv('SLACK_CLIENT_SECRET', '');
    await seed_runtime_tool_catalog(db);

    const response = await app.request('/v1/slack/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(409);
    expect(body.error).toEqual({
      code: 'slack_connect_unavailable',
      message:
        'Slack is not set up on this deployment: its OAuth client (SLACK_CLIENT_ID and SLACK_CLIENT_SECRET) is missing.',
    });
    expect(await db.select().from(connections)).toEqual([]);
  });

  it('starts the setup once the OAuth client is set', async () => {
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_ID', 'client');
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_SECRET', 'secret');

    const started = await connect_notion();

    expect(started.status).toBe(201);
    expect(started.body.data?.start_url).toEqual(expect.any(String));
  });
});
