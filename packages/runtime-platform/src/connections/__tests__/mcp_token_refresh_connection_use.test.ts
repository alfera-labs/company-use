import { open_counted_database } from '@coworker/core/db/__tests__/counted_database';
import {
  claim_connection_token_refresh,
  release_connection_token_refresh,
} from '@coworker/core/db/queries/connection_token_refresh_lease';
import { save_refreshed_connector_token } from '@coworker/core/db/queries/connectors';
import { apps, connections } from '@coworker/core/db/schema';
import {
  encrypt_connection_credentials,
  read_connection_credential_value,
} from '@coworker/core/integrations/credential_envelope';
import { create_id, id_prefixes } from '@coworker/shared';
import { renew_mcp_access_token } from '@runtime-platform/connections/mcp_token_refresh';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database_url = process.env.DATABASE_URL;

if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error('COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not');
}

const test_workspace_id = 'ws_mcp_refresh_connection_use_test';
const token_url = 'https://auth.acme.test/token';
const counted_databases: ReturnType<typeof open_counted_database>[] = [];

afterAll(async () => {
  if (!database_url) return;
  const cleanup = open_counted_database(database_url, 1);
  await cleanup.db.delete(connections).where(eq(connections.workspace_id, test_workspace_id));
  await cleanup.db.delete(apps).where(eq(apps.workspace_id, test_workspace_id));
  await cleanup.close();
  await Promise.all(counted_databases.map((counted) => counted.close()));
});

describe.skipIf(!database_url)(
  'pooled connections an MCP token refresh holds (needs real Postgres)',
  () => {
    beforeEach(() => {
      process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'mcp-refresh-connection-use-key';
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
    });

    it('trades the refresh token once, with no pooled connection held during the trade', async () => {
      const counted = open_counted_database(database_url ?? '', 8);
      counted_databases.push(counted);
      const connection = await create_expired_connection(counted.db);
      const in_use_during_trade: number[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          in_use_during_trade.push(counted.in_use());
          await new Promise((resolve) => setTimeout(resolve, 300));
          return Response.json({
            access_token: 'fresh-access',
            refresh_token: 'refresh-2',
            expires_in: 3600,
          });
        }),
      );

      const renewed = await Promise.all(
        Array.from({ length: 6 }, () => renew_mcp_access_token(counted.db, connection)),
      );

      expect(in_use_during_trade).toEqual([0]);
      expect(counted.most_in_use()).toBe(1);
      expect(
        renewed.map((row) =>
          read_connection_credential_value(row?.credentials ?? null, 'access_token'),
        ),
      ).toEqual(Array.from({ length: 6 }, () => 'fresh-access'));
    });

    it('waits for a refresh another process holds and reuses the token it saved', async () => {
      const counted = open_counted_database(database_url ?? '', 8);
      counted_databases.push(counted);
      const connection = await create_expired_connection(counted.db);
      const other_process = { connection_id: connection.connection_id, lease_token: 'other' };
      await claim_connection_token_refresh(counted.db, { ...other_process, lease_seconds: 30 });
      const token_server = vi.fn(async () => Response.json({ error: 'invalid_grant' }));
      vi.stubGlobal('fetch', token_server);
      setTimeout(async () => {
        await save_refreshed_connector_token(counted.db, {
          connection_id: connection.connection_id,
          existing_credentials: connection.credentials,
          values: { access_token: 'saved-by-other-process', refresh_token: 'refresh-2' },
          expiry_time: new Date(Date.now() + 3_600_000),
        });
        await release_connection_token_refresh(counted.db, other_process);
      }, 600);

      const renewed = await renew_mcp_access_token(counted.db, connection);

      expect(token_server).not.toHaveBeenCalled();
      expect(read_connection_credential_value(renewed?.credentials ?? null, 'access_token')).toBe(
        'saved-by-other-process',
      );
    });
  },
);

async function create_expired_connection(db: ReturnType<typeof open_counted_database>['db']) {
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: `mcp_${app_id}`,
    app_key: `mcp_${app_id}`,
    catalog_scope: 'workspace',
    workspace_id: test_workspace_id,
    app_display_name: 'Acme',
    metadata: {
      provider_configs: [
        {
          provider_key: 'mcp',
          provider_config_key: 'mcp:acme:workspace',
          version: 1,
          status: 'active',
          setup_defaults: {},
          connection_profiles: [
            {
              connection_profile_key: 'mcp:acme:workspace_credentials',
              version: 1,
              status: 'active',
              auth_method_key: 'mcp_workspace_credentials',
              runtime_credential_strategy: {},
              default_scopes: [],
              setup_strategy: {
                type: 'oauth2_authorization_code',
                token_url,
                client_id: 'acme-client',
                token_auth_method: 'none',
              },
            },
          ],
        },
      ],
    },
    created_by: 'system:test',
    last_updated_by: 'system:test',
  });
  const connection_id = create_id(id_prefixes.connection);
  const [connection] = await db
    .insert(connections)
    .values({
      connection_id,
      connection_key: `mcp:acme:${connection_id}`,
      workspace_id: test_workspace_id,
      app_id,
      connection_status: 'active',
      provider_key: 'mcp',
      provider_config_key: 'mcp:acme:workspace',
      connection_profile_key: 'mcp:acme:workspace_credentials',
      credentials: encrypt_connection_credentials({
        credential_source: 'oauth2',
        values: { access_token: 'stale-access', refresh_token: 'refresh-1' },
      }),
      credential_expiry_time: new Date(Date.now() - 60_000),
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!connection) throw new Error('The test connection was not created.');
  return connection;
}
