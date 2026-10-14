import { connector_oauth_client_env } from '@coworker/config/connector_oauth_clients';
import {
  connector_client_id_env,
  connector_client_secret_env,
  get_all_connector_apps,
  seed_connector_catalog,
} from '@coworker/connectors';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, connections } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { create_id, id_prefixes } from '@coworker/shared';
import { renew_expired_connector_access_token } from '@runtime-platform/connections/connector_token_refresh';
import { build_connector_connection } from '@runtime-platform/tools/connector_executor';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.CONNECTOR_HUBSPOT_CLIENT_ID = 'hubspot-client-id';
  process.env.CONNECTOR_HUBSPOT_CLIENT_SECRET = 'hubspot-client-secret';
});

async function create_hubspot_connection(
  db: Awaited<ReturnType<typeof create_test_database>>,
  credential_expiry_time: Date | null,
) {
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_connector_catalog(db);
  const hubspot_app = await db.query.apps.findFirst({ where: eq(apps.app_name, 'hubspot') });
  if (!hubspot_app) throw new Error('HubSpot connector app was not seeded');

  const connection_id = create_id(id_prefixes.connection);
  await db.insert(connections).values({
    connection_id,
    workspace_id: bootstrap.workspace_id,
    app_id: hubspot_app.app_id,
    connection_key: `native:hubspot:${connection_id}`,
    connection_name: 'HubSpot',
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: 'native:hubspot',
    connection_profile_key: 'native:hubspot:default',
    auth_method_key: 'oauth2_authorization_code',
    external_user_key: `ws_${bootstrap.workspace_id}`,
    authorized_scopes: [],
    health_status: 'healthy',
    connection_config: {},
    setup_state: {},
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'expired-access', refresh_token: 'the-refresh-token' },
    }),
    credential_expiry_time,
    provider_account: {},
    metadata: {},
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });

  const row = await db.query.connections.findFirst({
    where: eq(connections.connection_id, connection_id),
  });
  if (!row) throw new Error('Connection was not created');
  return { bootstrap, row };
}

beforeEach(() => {
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'connector-refresh-test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
});

afterAll(() => {
  delete process.env.CONNECTOR_HUBSPOT_CLIENT_ID;
  delete process.env.CONNECTOR_HUBSPOT_CLIENT_SECRET;
});

describe('connector_oauth_client_env', () => {
  it('names the variables the catalog seed names, for every oauth2 connector app', () => {
    const oauth_apps = get_all_connector_apps().filter((app) => app.auth.kind === 'oauth2');
    const seeded_names = Object.fromEntries(
      oauth_apps.map((app) => [
        app.app_key,
        {
          client_id: connector_client_id_env(app.app_key),
          client_secret: connector_client_secret_env(app.app_key),
        },
      ]),
    );

    expect(connector_oauth_client_env).toEqual(seeded_names);
  });
});

describe('renew_expired_connector_access_token', () => {
  it('trades the refresh token at the app’s own token url and stores what came back', async () => {
    const db = await create_test_database();
    const { row } = await create_hubspot_connection(db, new Date(Date.now() - 60_000));
    const fetch_mock = vi.fn(async () =>
      Response.json({ access_token: 'fresh-access', expires_in: 1800, token_type: 'bearer' }),
    );
    vi.stubGlobal('fetch', fetch_mock);

    const renewed = await renew_expired_connector_access_token(db, row);
    if (!renewed) throw new Error('The connection was dropped by the refresh');
    const stored = await db.query.connections.findFirst({
      where: eq(connections.connection_id, row.connection_id),
    });

    const [token_url, request] = fetch_mock.mock.calls[0] as unknown as [string, RequestInit];
    const body = request.body as URLSearchParams;
    expect(token_url).toBe('https://api.hubapi.com/oauth/v1/token');
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('the-refresh-token');
    expect(body.get('client_id')).toBe('hubspot-client-id');
    expect(body.get('client_secret')).toBe('hubspot-client-secret');
    expect((request.headers as Record<string, string>).Accept).toBe('application/json');

    expect(build_connector_connection(renewed)?.access_token).toBe('fresh-access');
    expect(stored?.credential_expiry_time?.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(stored?.credentials)).not.toContain('fresh-access');
  });

  it('keeps the refresh token a provider did not return again', async () => {
    const db = await create_test_database();
    const { row } = await create_hubspot_connection(db, new Date(Date.now() - 60_000));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ access_token: 'fresh-access', expires_in: 1800 })),
    );

    const renewed = await renew_expired_connector_access_token(db, row);
    if (!renewed) throw new Error('The connection was dropped by the refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ access_token: 'fresher-access', expires_in: 1800 })),
    );
    const renewed_again = await renew_expired_connector_access_token(
      db,
      { ...renewed, credential_expiry_time: new Date(Date.now() - 60_000) },
      new Date(),
    );

    if (!renewed_again) throw new Error('The connection was dropped by the refresh');
    expect(build_connector_connection(renewed_again)?.access_token).toBe('fresher-access');
  });

  it('leaves a token that has not expired alone', async () => {
    const db = await create_test_database();
    const { row } = await create_hubspot_connection(db, new Date(Date.now() + 30 * 60_000));
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);

    const renewed = await renew_expired_connector_access_token(db, row);

    expect(fetch_mock).not.toHaveBeenCalled();
    if (!renewed) throw new Error('The connection was dropped by the refresh');
    expect(build_connector_connection(renewed)?.access_token).toBe('expired-access');
  });

  it('leaves a connection with no expiry alone', async () => {
    const db = await create_test_database();
    const { row } = await create_hubspot_connection(db, null);
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);

    await renew_expired_connector_access_token(db, row);

    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it('keeps the stale token when the provider refuses the refresh', async () => {
    const db = await create_test_database();
    const { row } = await create_hubspot_connection(db, new Date(Date.now() - 60_000));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })),
    );

    const renewed = await renew_expired_connector_access_token(db, row);

    if (!renewed) throw new Error('The connection was dropped by the refresh');
    expect(build_connector_connection(renewed)?.access_token).toBe('expired-access');
  });
});
