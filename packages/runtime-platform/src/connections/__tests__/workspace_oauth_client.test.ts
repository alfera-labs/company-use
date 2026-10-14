import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_pending_connection_setup,
  finalize_oauth_connection,
  reconnect_connection,
} from '@coworker/core/db/queries/connection_management';
import { apps, connections } from '@coworker/core/db/schema';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import { create_id, id_prefixes } from '@coworker/shared';
import { exchange_oauth_code_for_tokens } from '@runtime-platform/connections/oauth_connection_setup';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const client_secret = 'sbp-customer-owned-secret';

async function create_pending_setup_with_own_client(
  db: Awaited<ReturnType<typeof create_test_database>>,
) {
  const bootstrap = await bootstrap_default_workspace(db);
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: 'supabase',
    app_key: 'supabase',
    catalog_scope: 'global',
    app_display_name: 'Supabase',
    auth_type: 'oauth2',
    app_status: 'active',
    display_config: {},
    metadata: {
      provider_configs: [
        {
          provider_key: 'native',
          provider_config_key: 'native:supabase',
          version: 1,
          status: 'active',
          provider_app_key: 'supabase',
          setup_defaults: {},
          connection_profiles: [
            {
              connection_profile_key: 'native:supabase:oauth',
              version: 1,
              status: 'active',
              auth_method_key: 'oauth2',
              setup_strategy: {
                type: 'oauth2_authorization_code',
                authorization_url: 'https://api.supabase.test/v1/oauth/authorize',
                token_url: 'https://api.supabase.test/v1/oauth/token',
                client_id: 'customer-client-id',
                token_auth_method: 'client_secret_post',
                scopes: ['projects.read'],
              },
              runtime_credential_strategy: { type: 'oauth2_credentials' },
              default_scopes: ['projects.read'],
            },
          ],
        },
      ],
    },
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });

  const setup = await create_pending_connection_setup(db, {
    workspace_id: bootstrap.workspace_id,
    app_id,
    provider_key: 'native',
    actor_id: bootstrap.user_id,
    oauth_client_secret: client_secret,
  });

  return { bootstrap, setup };
}

afterEach(() => vi.unstubAllGlobals());

describe('connecting with a workspace-supplied OAuth client', () => {
  it('stores the secret encrypted, never in plaintext setup state', async () => {
    const db = await create_test_database();
    const { setup } = await create_pending_setup_with_own_client(db);

    const row = await db.query.connections.findFirst({
      where: eq(connections.connection_id, setup.connection.connection_id),
    });

    expect(JSON.stringify(row?.setup_state)).not.toContain(client_secret);
    expect(JSON.stringify(row?.credentials)).not.toContain(client_secret);
    expect(read_connection_credential_value(row?.credentials ?? null, 'oauth_client_secret')).toBe(
      client_secret,
    );
  });

  it('leaves behind only this authorization, plus the client secret', async () => {
    const db = await create_test_database();
    const { bootstrap, setup } = await create_pending_setup_with_own_client(db);
    const state_token = (setup.setup as { oauth_state_token?: string }).oauth_state_token;
    if (!state_token) throw new Error('OAuth state token was not created');

    await finalize_oauth_connection(db, {
      workspace_id: bootstrap.workspace_id,
      state_token,
      status: 'success',
      token_response: {
        access_token: 'first-access',
        refresh_token: 'first-refresh',
        token_type: 'Bearer',
      },
      actor_id: bootstrap.user_id,
    });

    await reconnect_connection(db, {
      workspace_id: bootstrap.workspace_id,
      connection_id: setup.connection.connection_id,
      actor_id: bootstrap.user_id,
    });
    const pending = await db.query.connections.findFirst({
      where: eq(connections.connection_id, setup.connection.connection_id),
    });
    const next_state = (pending?.setup_state as { oauth_state_token?: string })?.oauth_state_token;
    if (!next_state) throw new Error('Reconnect produced no OAuth state token');

    await finalize_oauth_connection(db, {
      workspace_id: bootstrap.workspace_id,
      state_token: next_state,
      status: 'success',
      token_response: { access_token: 'second-access', token_type: 'Bearer' },
      actor_id: bootstrap.user_id,
    });

    const row = await db.query.connections.findFirst({
      where: eq(connections.connection_id, setup.connection.connection_id),
    });
    const read = (key: string) => read_connection_credential_value(row?.credentials ?? null, key);
    expect(read('access_token')).toBe('second-access');
    expect(read('refresh_token')).toBeNull();
    expect(read('oauth_client_secret')).toBe(client_secret);
  });

  it('sends the stored secret to the token endpoint, and still holds it once connected', async () => {
    const db = await create_test_database();
    const { bootstrap, setup } = await create_pending_setup_with_own_client(db);

    let posted_body = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        posted_body = String(init?.body ?? '');
        return Response.json({
          access_token: 'supabase-access-token',
          refresh_token: 'supabase-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    const row = await db.query.connections.findFirst({
      where: eq(connections.connection_id, setup.connection.connection_id),
    });
    const token_response = await exchange_oauth_code_for_tokens({
      setup_state: setup.setup,
      code: 'authorization-code',
      credentials: row?.credentials ?? null,
    });

    expect(posted_body).toContain(encodeURIComponent(client_secret));
    expect(posted_body).toContain('customer-client-id');

    const state_token = (setup.setup as { oauth_state_token?: string }).oauth_state_token;
    if (!state_token) throw new Error('OAuth state token was not created');
    await finalize_oauth_connection(db, {
      workspace_id: bootstrap.workspace_id,
      state_token,
      status: 'success',
      token_response,
      actor_id: bootstrap.user_id,
    });

    const connected = await db.query.connections.findFirst({
      where: eq(connections.connection_id, setup.connection.connection_id),
    });
    expect(connected?.connection_status).toBe('active');
    expect(read_connection_credential_value(connected?.credentials ?? null, 'access_token')).toBe(
      'supabase-access-token',
    );
    expect(
      read_connection_credential_value(connected?.credentials ?? null, 'oauth_client_secret'),
    ).toBe(client_secret);
  });
});
