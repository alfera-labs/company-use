import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_pending_oauth_connection_setup } from '@coworker/core/db/queries/connection_management';
import { connections } from '@coworker/core/db/schema';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { build_public_connection_setup } from '@runtime-platform/connections/oauth_connection_setup';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

const server_url = 'https://mcp.acme.test/mcp';
const auth_origin = 'https://auth.acme.test';

const registered_redirect_uris: string[] = [];

function stub_authorization_server() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === server_url) {
        return new Response(JSON.stringify({ error: 'invalid_token' }), {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate': `Bearer resource_metadata="https://mcp.acme.test/.well-known/oauth-protected-resource/mcp"`,
          },
        });
      }

      if (url.includes('/.well-known/oauth-protected-resource')) {
        return json_response({ resource: server_url, authorization_servers: [auth_origin] });
      }

      if (url.includes('/.well-known/oauth-authorization-server')) {
        return json_response({
          issuer: auth_origin,
          authorization_endpoint: `${auth_origin}/authorize`,
          token_endpoint: `${auth_origin}/token`,
          registration_endpoint: `${auth_origin}/register`,
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          scopes_supported: ['read', 'write'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      }

      if (url === `${auth_origin}/register`) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { redirect_uris?: string[] };
        registered_redirect_uris.push(...(body.redirect_uris ?? []));
        return json_response({ client_id: 'client_acme_123' });
      }

      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
}

function stub_authorization_server_without_registration() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === server_url) {
        return new Response(JSON.stringify({ error: 'invalid_token' }), {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate': `Bearer resource_metadata="https://mcp.acme.test/.well-known/oauth-protected-resource/mcp"`,
          },
        });
      }

      if (url.includes('/.well-known/oauth-protected-resource')) {
        return json_response({ resource: server_url, authorization_servers: [auth_origin] });
      }

      if (url.includes('/.well-known/oauth-authorization-server')) {
        return json_response({
          issuer: auth_origin,
          authorization_endpoint: `${auth_origin}/authorize`,
          token_endpoint: `${auth_origin}/token`,
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          scopes_supported: ['projects.read'],
        });
      }

      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
}

function stub_authorization_server_issuing_a_secret() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === server_url) {
        return new Response(JSON.stringify({ error: 'invalid_token' }), {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate': `Bearer resource_metadata="https://mcp.acme.test/.well-known/oauth-protected-resource/mcp"`,
          },
        });
      }

      if (url.includes('/.well-known/oauth-protected-resource')) {
        return json_response({ resource: server_url, authorization_servers: [auth_origin] });
      }

      if (url.includes('/.well-known/oauth-authorization-server')) {
        return json_response({
          issuer: auth_origin,
          authorization_endpoint: `${auth_origin}/authorize`,
          token_endpoint: `${auth_origin}/token`,
          registration_endpoint: `${auth_origin}/register`,
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          scopes_supported: ['projects.read'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
        });
      }

      if (url === `${auth_origin}/register`) {
        return json_response({
          client_id: 'registered-client-id',
          client_secret: 'registered-client-secret',
        });
      }

      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
}

function json_response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('adding an MCP server that requires OAuth', () => {
  beforeEach(() => {
    registered_redirect_uris.length = 0;
    stub_authorization_server();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the exact redirect URI the authorize request will send', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    expect(outcome.kind).toBe('needs_authorization');
    if (outcome.kind !== 'needs_authorization') return;

    const connection = await db.query.connections.findFirst({
      where: eq(connections.connection_id, outcome.connection_id),
    });
    const setup = await build_public_connection_setup({
      provider_key: 'mcp',
      setup_state: connection?.setup_state ?? {},
      db,
    });
    const authorize_url = new URL(String(setup.authorization_url));

    expect(registered_redirect_uris).toHaveLength(1);
    expect(authorize_url.searchParams.get('redirect_uri')).toBe(registered_redirect_uris[0]);
  });

  it('offers sign-in again when the same server is added twice', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const add_once = () =>
      define_mcp_client_connection({
        db,
        workspace_id: bootstrap.workspace_id,
        actor_id: bootstrap.user_id,
        server_url,
        redirect_uri: 'https://app.example.test/connect/callback',
      });

    const first = await add_once();
    expect(first.kind).toBe('needs_authorization');
    if (first.kind !== 'needs_authorization') return;

    const second = await add_once();
    expect(second.kind).toBe('needs_authorization');
    if (second.kind !== 'needs_authorization') return;
    expect(second.app_id).toBe(first.app_id);
    expect(second.connection_id).not.toBe(first.connection_id);
    expect(new URL(second.start_url).searchParams.get('setup_token')).toBeTruthy();

    expect(registered_redirect_uris).toHaveLength(1);
  });

  it('carries the interrupted ask onto the pending setup, first time and on a re-add', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const resume = {
      session_id: 'ses_mcp_resume',
      actor_id: bootstrap.user_id,
      instruction: 'Look up the React 19 docs and summarize the changes.',
      created_at: new Date().toISOString(),
    };
    const add_once = () =>
      define_mcp_client_connection({
        db,
        workspace_id: bootstrap.workspace_id,
        actor_id: bootstrap.user_id,
        server_url,
        redirect_uri: 'https://app.example.test/connect/callback',
        setup_session_id: resume.session_id,
        resume,
      });

    const first = await add_once();
    const second = await add_once();
    expect(first.kind).toBe('needs_authorization');
    expect(second.kind).toBe('needs_authorization');
    if (first.kind !== 'needs_authorization' || second.kind !== 'needs_authorization') return;

    for (const connection_id of [first.connection_id, second.connection_id]) {
      const connection = await db.query.connections.findFirst({
        where: eq(connections.connection_id, connection_id),
      });
      expect(connection?.setup_state).toMatchObject({
        setup_session_id: resume.session_id,
        resume: { session_id: resume.session_id, instruction: resume.instruction },
      });
    }
  });

  it('uses a client the workspace registered itself when the server offers none', async () => {
    stub_authorization_server_without_registration();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const client_secret = 'customer-owned-secret';

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
      oauth_client: { client_id: 'customer-client-id', client_secret },
    });

    expect(outcome.kind).toBe('needs_authorization');
    if (outcome.kind !== 'needs_authorization') return;

    const connection = await db.query.connections.findFirst({
      where: eq(connections.connection_id, outcome.connection_id),
    });
    expect(JSON.stringify(connection?.setup_state)).not.toContain(client_secret);
    expect(JSON.stringify(connection?.credentials)).not.toContain(client_secret);
    expect(
      read_connection_credential_value(connection?.credentials ?? null, 'oauth_client_secret'),
    ).toBe(client_secret);

    const setup = await build_public_connection_setup({
      provider_key: 'mcp',
      setup_state: connection?.setup_state ?? {},
      credentials: connection?.credentials ?? null,
      db,
    });
    const authorize_url = new URL(String(setup.authorization_url));
    expect(authorize_url.searchParams.get('client_id')).toBe('customer-client-id');
  });

  it('keeps the workspace client when the same server is added a second time', async () => {
    stub_authorization_server_without_registration();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const add_with = (client_id: string, client_secret: string) =>
      define_mcp_client_connection({
        db,
        workspace_id: bootstrap.workspace_id,
        actor_id: bootstrap.user_id,
        server_url,
        redirect_uri: 'https://app.example.test/connect/callback',
        oauth_client: { client_id, client_secret },
      });

    await add_with('typo-client-id', 'typo-secret');
    const second = await add_with('correct-client-id', 'correct-secret');

    expect(second.kind).toBe('needs_authorization');
    if (second.kind !== 'needs_authorization') return;

    const connection = await db.query.connections.findFirst({
      where: eq(connections.connection_id, second.connection_id),
    });
    expect(
      read_connection_credential_value(connection?.credentials ?? null, 'oauth_client_secret'),
    ).toBe('correct-secret');

    const setup = await build_public_connection_setup({
      provider_key: 'mcp',
      setup_state: connection?.setup_state ?? {},
      credentials: connection?.credentials ?? null,
      db,
    });
    expect(setup.setup_error).toBeNull();
    expect(new URL(String(setup.authorization_url)).searchParams.get('client_id')).toBe(
      'correct-client-id',
    );
  });

  it('keeps the client secret that registration issues', async () => {
    stub_authorization_server_issuing_a_secret();
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    expect(outcome.kind).toBe('needs_authorization');
    if (outcome.kind !== 'needs_authorization') return;

    const connection = await db.query.connections.findFirst({
      where: eq(connections.connection_id, outcome.connection_id),
    });
    expect(
      read_connection_credential_value(connection?.credentials ?? null, 'oauth_client_secret'),
    ).toBe('registered-client-secret');

    const setup = await build_public_connection_setup({
      provider_key: 'mcp',
      setup_state: connection?.setup_state ?? {},
      credentials: connection?.credentials ?? null,
      db,
    });
    expect(setup.setup_error).toBeNull();
    expect(new URL(String(setup.authorization_url)).searchParams.get('client_id')).toBe(
      'registered-client-id',
    );
  });

  it('hands back a link a person can actually open', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
    });

    expect(outcome.kind).toBe('needs_authorization');
    if (outcome.kind !== 'needs_authorization') return;

    const start_url = new URL(outcome.start_url);
    expect(start_url.pathname).toBe('/connect/start');
    expect(start_url.searchParams.get('connection_id')).toBe(outcome.connection_id);
    expect(start_url.searchParams.get('setup_token')).toBeTruthy();

    const pending = await get_pending_oauth_connection_setup(db, {
      state_token: String(
        (
          await db.query.connections.findFirst({
            where: eq(connections.connection_id, outcome.connection_id),
          })
        )?.setup_state.oauth_state_token,
      ),
    });
    expect(pending?.connection_id).toBe(outcome.connection_id);
  });

  it('carries PKCE S256 and the resource indicator onto the consent link', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const outcome = await define_mcp_client_connection({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      server_url,
      redirect_uri: 'https://app.example.test/connect/callback',
    });
    if (outcome.kind !== 'needs_authorization') throw new Error('expected authorization');

    const connection = await db.query.connections.findFirst({
      where: eq(connections.connection_id, outcome.connection_id),
    });
    const setup = await build_public_connection_setup({
      provider_key: 'mcp',
      setup_state: connection?.setup_state ?? {},
      db,
    });
    const authorize_url = new URL(String(setup.authorization_url));

    expect(authorize_url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize_url.searchParams.get('resource')).toBe(server_url);
    expect(authorize_url.searchParams.get('client_id')).toBe('client_acme_123');
  });
});
