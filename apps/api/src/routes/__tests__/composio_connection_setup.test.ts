import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'composio_test_key';
});

import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import {
  composio_retry_maximum_attempts,
  reset_composio_client_for_tests,
} from '@runtime-platform/composio/composio_client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type RecordedRequest = { url: string; method: string; body: unknown };
type ComposioResponse = { status?: number; headers?: Record<string, string>; body: unknown };

function stub_composio_api(routes: Array<{ path: string; respond: ComposioResponse }>) {
  const requests: RecordedRequest[] = [];
  const remaining = [...routes];

  const stubbed_fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const request_url = String(url);
    const body_text = typeof init?.body === 'string' ? init.body : null;
    requests.push({
      url: request_url,
      method: init?.method ?? 'GET',
      body: body_text ? JSON.parse(body_text) : null,
    });

    const match_index = remaining.findIndex((route) => request_url.includes(route.path));
    if (match_index < 0) {
      throw new Error(`No stubbed Composio route for ${init?.method ?? 'GET'} ${request_url}`);
    }
    const [route] = remaining.splice(match_index, 1);
    return new Response(JSON.stringify(route?.respond.body ?? {}), {
      status: route?.respond.status ?? 200,
      headers: { 'content-type': 'application/json', ...route?.respond.headers },
    });
  });

  vi.stubGlobal('fetch', stubbed_fetch);
  return { requests, stubbed_fetch };
}

function identity_probe_routes(input: { endpoint: string | null; answer?: unknown }) {
  return [
    {
      path: '/toolkits/attio',
      respond: {
        body: {
          slug: 'attio',
          name: 'Attio',
          get_current_user_endpoint: input.endpoint,
          get_current_user_endpoint_method: 'GET',
          meta: {},
        },
      },
    },
    ...(input.endpoint
      ? [{ path: '/tools/execute/proxy', respond: { body: { status: 200, data: input.answer } } }]
      : []),
  ];
}

function connected_account(input: {
  status: string;
  status_reason?: string;
  requested_scopes?: string[];
  granted_scope?: string;
}) {
  return {
    id: 'ca_attio_test',
    toolkit: { slug: 'attio' },
    auth_config: { id: 'ac_created', auth_scheme: 'OAUTH2', is_composio_managed: true },
    status: input.status,
    ...(input.status_reason ? { status_reason: input.status_reason } : {}),
    word_id: 'brave-otter',
    alias: null,
    user_id: 'ws_external_attio',
    requested_scopes: input.requested_scopes ?? [],
    state: {
      authScheme: 'OAUTH2',
      val: {
        access_token: 'never-copied',
        ...(input.granted_scope ? { scope: input.granted_scope } : {}),
      },
    },
  };
}

async function create_composio_setup_context() {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  const app_row = await insert_composio_test_app(db);
  const app = create_app(db);

  const create_response = await app.request('/v1/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'composio' }),
  });
  const created = (await create_response.json()).data;
  const connection_id = created.connection.connection_id;
  const stored = await db.query.connections.findFirst({
    where: (table, { eq }) => eq(table.connection_id, connection_id),
  });

  return {
    db,
    app,
    app_row,
    create_response,
    created,
    connection_id,
    setup_state: (stored?.setup_state ?? {}) as Record<string, unknown>,
  };
}

async function read_setup_state(
  db: Awaited<ReturnType<typeof create_test_database>>,
  connection_id: string,
) {
  const row = await db.query.connections.findFirst({
    where: (table, { eq }) => eq(table.connection_id, connection_id),
  });
  return (row?.setup_state ?? {}) as Record<string, unknown>;
}

describe('composio connection setup api routes', () => {
  beforeEach(() => {
    reset_composio_client_for_tests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    reset_composio_client_for_tests();
  });

  it('creates a pending hosted_connect_link setup with a start link', async () => {
    const context = await create_composio_setup_context();

    expect(context.create_response.status).toBe(201);
    expect(context.created).toMatchObject({
      connection: { connection_status: 'pending_setup', provider_key: 'composio' },
      setup: { type: 'hosted_connect_link', provider_app_key: 'attio' },
      start_url: expect.stringContaining('/connect/start'),
    });
    expect(context.created.setup.setup_token).toBeUndefined();
    expect(context.setup_state).toMatchObject({
      type: 'hosted_connect_link',
      setup_strategy: {
        type: 'hosted_connect_link',
        auth_scheme: 'OAUTH2',
        auth_config_source: 'composio_managed',
      },
      provider_webhook_token: expect.any(String),
    });
  });

  it('creates the auth config, mints a connect link, and stores the connected account id', async () => {
    const context = await create_composio_setup_context();
    const { requests } = stub_composio_api([
      { path: '/auth_configs', respond: { body: { items: [], next_cursor: null } } },
      {
        path: '/auth_configs',
        respond: {
          body: {
            toolkit: { slug: 'attio' },
            auth_config: {
              id: 'ac_created',
              auth_scheme: 'OAUTH2',
              is_composio_managed: true,
            },
          },
        },
      },
      {
        path: '/connected_accounts/link',
        respond: {
          body: {
            link_token: 'lt_test',
            redirect_url: 'https://backend.composio.dev/s/connect/link_test',
            expires_at: '2026-09-14T00:00:00.000Z',
            connected_account_id: 'ca_attio_test',
          },
        },
      },
    ]);

    const start_response = await context.app.request(
      `/v1/connections/setup/start?connection_id=${context.connection_id}` +
        `&setup_token=${context.setup_state.setup_token}`,
    );
    const body = await start_response.json();

    expect(start_response.status).toBe(200);
    expect(body.data).toMatchObject({
      connection_id: context.connection_id,
      setup_url: 'https://backend.composio.dev/s/connect/link_test',
    });
    expect(requests[0]?.url).toContain('toolkit_slug=attio');
    expect(requests[1]?.body).toEqual({
      toolkit: { slug: 'attio' },
      auth_config: { type: 'use_composio_managed_auth', name: 'alfera_attio_managed' },
    });
    expect(requests[2]?.body).toMatchObject({
      auth_config_id: 'ac_created',
      user_id: context.setup_state.external_user_key,
    });

    const setup_state = await read_setup_state(context.db, context.connection_id);
    expect(setup_state).toMatchObject({
      provider_auth_config_id: 'ac_created',
      provider_connected_account_id: 'ca_attio_test',
      hosted_connect_link: 'https://backend.composio.dev/s/connect/link_test',
    });
    expect(setup_state.setup_token).toBe(context.setup_state.setup_token);
  });

  it('reuses an existing composio-managed auth config for the same scheme', async () => {
    const context = await create_composio_setup_context();
    const { requests } = stub_composio_api([
      {
        path: '/auth_configs',
        respond: {
          body: {
            items: [
              {
                id: 'ac_disabled',
                toolkit: { slug: 'attio' },
                auth_scheme: 'OAUTH2',
                is_composio_managed: true,
                status: 'DISABLED',
              },
              {
                id: 'ac_custom',
                toolkit: { slug: 'attio' },
                auth_scheme: 'OAUTH2',
                is_composio_managed: false,
                status: 'ENABLED',
              },
              {
                id: 'ac_existing',
                toolkit: { slug: 'attio' },
                auth_scheme: 'OAUTH2',
                is_composio_managed: true,
                status: 'ENABLED',
              },
            ],
            next_cursor: null,
          },
        },
      },
      {
        path: '/connected_accounts/link',
        respond: {
          body: {
            link_token: 'lt_test',
            redirect_url: 'https://backend.composio.dev/s/connect/link_reuse',
            expires_at: '2026-09-14T00:00:00.000Z',
            connected_account_id: 'ca_attio_test',
          },
        },
      },
    ]);

    const start_response = await context.app.request(
      `/v1/connections/setup/start?connection_id=${context.connection_id}` +
        `&setup_token=${context.setup_state.setup_token}`,
    );

    expect(start_response.status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).toMatchObject({ auth_config_id: 'ac_existing' });
  });

  it('reports 409 while Composio is still finishing the connected account', async () => {
    const context = await create_composio_setup_context();
    await start_hosted_setup(context);
    stub_composio_api([
      {
        path: '/connected_accounts/ca_attio_test',
        respond: { body: connected_account({ status: 'INITIATED' }) },
      },
    ]);

    const response = await context.app.request(
      `/v1/connections/setup/complete?connection_id=${context.connection_id}` +
        `&setup_token=${context.setup_state.setup_token}`,
      { method: 'POST' },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: 'provider_connection_not_ready' });
  });

  it('activates the connection when the connected account is ACTIVE', async () => {
    const context = await create_composio_setup_context();
    await start_hosted_setup(context);
    stub_composio_api([
      {
        path: '/connected_accounts/ca_attio_test',
        respond: {
          body: connected_account({
            status: 'ACTIVE',
            requested_scopes: ['record:read'],
            granted_scope: 'record:read record:write task:read-write',
          }),
        },
      },
      ...identity_probe_routes({
        endpoint: 'https://api.attio.com/v2/self',
        answer: { active: true, workspace_name: 'Lovelace Ltd', email: 'ada@example.com' },
      }),
    ]);

    const response = await context.app.request(
      `/v1/connections/setup/complete?connection_id=${context.connection_id}` +
        `&setup_token=${context.setup_state.setup_token}`,
      { method: 'POST' },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      connection_id: context.connection_id,
      connection_status: 'active',
      external_account_id: 'ca_attio_test',
      external_account_name: 'ada@example.com',
      authorized_scopes: ['record:read', 'record:write', 'task:read-write'],
      provider_account: {
        connected_account_id: 'ca_attio_test',
        auth_config_id: 'ac_created',
        auth_scheme: 'OAUTH2',
        toolkit_slug: 'attio',
        word_id: 'brave-otter',
        identity: {
          endpoint: 'https://api.attio.com/v2/self',
          data: { active: true, workspace_name: 'Lovelace Ltd', email: 'ada@example.com' },
        },
        source: 'composio_connect_link',
      },
    });
    expect(JSON.stringify(body.data)).not.toContain('never-copied');
  });

  it('fails the connection with the provider status reason', async () => {
    const context = await create_composio_setup_context();
    await start_hosted_setup(context);
    stub_composio_api([
      {
        path: '/connected_accounts/ca_attio_test',
        respond: {
          body: connected_account({
            status: 'FAILED',
            status_reason: 'The person denied the Attio consent screen.',
          }),
        },
      },
    ]);

    const response = await context.app.request(
      `/v1/connections/setup/complete?connection_id=${context.connection_id}` +
        `&setup_token=${context.setup_state.setup_token}`,
      { method: 'POST' },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      connection_status: 'failed',
      setup_state: { error_message: 'The person denied the Attio consent screen.' },
    });
  });

  it('refuses completion for a provider with no connection adapter', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_composio_test_app(db, { provider_key: 'unknown_provider' });
    const app = create_app(db);

    const create_response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app_row.app_id, provider_key: 'unknown_provider' }),
    });
    const created = (await create_response.json()).data;
    const stored = await db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, created.connection.connection_id),
    });
    const setup_state = (stored?.setup_state ?? {}) as Record<string, unknown>;

    const response = await app.request(
      `/v1/connections/setup/complete?connection_id=${created.connection.connection_id}` +
        `&setup_token=${setup_state.setup_token}`,
      { method: 'POST' },
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.message).toBe('Provider setup completion is not supported for this provider');
  });

  it('reports 409 when completion runs before the hosted setup created an account', async () => {
    const context = await create_composio_setup_context();
    const { stubbed_fetch } = stub_composio_api([]);

    const response = await context.app.request(
      `/v1/connections/setup/complete?connection_id=${context.connection_id}` +
        `&setup_token=${context.setup_state.setup_token}`,
      { method: 'POST' },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: 'provider_connection_not_ready' });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('reads the matching managed auth config off a later page instead of creating one', async () => {
    const context = await create_composio_setup_context();
    const { requests } = stub_composio_api([
      {
        path: '/auth_configs',
        respond: {
          body: {
            items: [
              {
                id: 'ac_page1',
                toolkit: { slug: 'attio' },
                auth_scheme: 'API_KEY',
                is_composio_managed: true,
                status: 'ENABLED',
              },
            ],
            next_cursor: 'cursor_page2',
          },
        },
      },
      {
        path: '/auth_configs',
        respond: {
          body: {
            items: [
              {
                id: 'ac_page2',
                toolkit: { slug: 'attio' },
                auth_scheme: 'OAUTH2',
                is_composio_managed: true,
                status: 'ENABLED',
              },
            ],
            next_cursor: null,
          },
        },
      },
      {
        path: '/connected_accounts/link',
        respond: {
          body: {
            link_token: 'lt_page2',
            redirect_url: 'https://backend.composio.dev/s/connect/link_page2',
            expires_at: '2026-09-14T00:00:00.000Z',
            connected_account_id: 'ca_attio_test',
          },
        },
      },
    ]);

    const start_response = await context.app.request(
      `/v1/connections/setup/start?connection_id=${context.connection_id}` +
        `&setup_token=${context.setup_state.setup_token}`,
    );

    expect(start_response.status).toBe(200);
    expect(requests).toHaveLength(3);
    expect(requests[1]?.url).toContain('cursor=cursor_page2');
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    expect(requests[2]?.body).toMatchObject({ auth_config_id: 'ac_page2' });
  });

  it('refuses the start with 422 when Composio cannot list auth configs', async () => {
    const context = await create_composio_setup_context();
    const outage = {
      path: '/auth_configs',
      respond: {
        status: 500,
        headers: { 'retry-after': '0' },
        body: { error: { message: 'Composio is temporarily unavailable.', status: 500 } },
      },
    };
    stub_composio_api(Array.from({ length: composio_retry_maximum_attempts }, () => outage));

    const start_response = await context.app.request(
      `/v1/connections/setup/start?connection_id=${context.connection_id}` +
        `&setup_token=${context.setup_state.setup_token}`,
    );
    const text = await start_response.text();

    expect(start_response.status).toBe(422);
    expect(JSON.parse(text).error).toMatchObject({
      code: 'connection_setup_unavailable',
      message: 'Composio is temporarily unavailable.',
    });
    expect(text).not.toContain(context.setup_state.setup_token);
  });

  it('refuses a provider webhook carrying the wrong token', async () => {
    const context = await create_composio_setup_context();
    await start_hosted_setup(context);
    const { stubbed_fetch } = stub_composio_api([]);

    const response = await post_provider_webhook(context, {
      provider_key: 'composio',
      query: '&provider_webhook_token=not_the_token',
      body: { status: 'ACTIVE' },
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toMatchObject({ code: 'invalid_provider_webhook_token' });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('activates the connection from a provider webhook carrying the right token', async () => {
    const context = await create_composio_setup_context();
    await start_hosted_setup(context);
    const setup_state = await read_setup_state(context.db, context.connection_id);
    stub_composio_api([
      {
        path: '/connected_accounts/ca_attio_test',
        respond: { body: connected_account({ status: 'ACTIVE' }) },
      },
      ...identity_probe_routes({ endpoint: null }),
    ]);

    const response = await post_provider_webhook(context, {
      provider_key: 'composio',
      query: `&provider_webhook_token=${setup_state.provider_webhook_token}`,
      body: { status: 'ACTIVE' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      connection_id: context.connection_id,
      connection_status: 'active',
      external_account_id: 'ca_attio_test',
    });
  });

  it('finalizes an untokened provider webhook from the provider state, not the payload', async () => {
    const context = await create_composio_setup_context();
    await start_hosted_setup(context);
    const { requests } = stub_composio_api([
      {
        path: '/connected_accounts/ca_attio_test',
        respond: { body: connected_account({ status: 'INITIATED' }) },
      },
    ]);

    const response = await post_provider_webhook(context, {
      provider_key: 'composio',
      body: { status: 'ACTIVE', connected_account_id: 'ca_attio_test' },
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: 'provider_connection_not_ready' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain('/connected_accounts/ca_attio_test');
    const stored = await context.db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, context.connection_id),
    });
    expect(stored?.connection_status).toBe('pending_setup');
  });

  it('refuses a provider webhook for a prototype key', async () => {
    const context = await create_composio_setup_context();
    const { stubbed_fetch } = stub_composio_api([]);

    const response = await post_provider_webhook(context, {
      provider_key: '__proto__',
      body: {},
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: 'validation_error',
      message: 'Provider webhook is not supported for this provider',
    });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('refuses a connection whose redirect_uri leaves the allowed origins', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app_row = await insert_composio_test_app(db);
    const app = create_app(db);
    const { stubbed_fetch } = stub_composio_api([]);

    const response = await app.request('/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: app_row.app_id,
        provider_key: 'composio',
        redirect_uri: 'https://attacker.example/connect/callback',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: 'validation_error',
      message: 'redirect_uri must be on an allowed origin',
      details: { origin: 'https://attacker.example' },
    });
    expect(stubbed_fetch).not.toHaveBeenCalled();
    expect(await db.query.connections.findFirst()).toBeUndefined();
  });

  it('deletes the Composio connected account when the connection is revoked', async () => {
    const context = await create_composio_setup_context();
    await activate_composio_connection(context);
    const { requests } = stub_composio_api([
      { path: '/connected_accounts/ca_attio_test', respond: { body: { success: true } } },
    ]);

    const response = await context.app.request(`/v1/connections/${context.connection_id}/revoke`, {
      method: 'POST',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ connection_status: 'revoked' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('DELETE');
    expect(requests[0]?.url).toContain('/connected_accounts/ca_attio_test');
    expect(requests[0]?.url).toContain('revoke_on_delete=true');
  });

  it('revokes the connection even when Composio refuses the account delete', async () => {
    const context = await create_composio_setup_context();
    await activate_composio_connection(context);
    stub_composio_api([
      {
        path: '/connected_accounts/ca_attio_test',
        respond: { status: 500, body: { error: { message: 'Composio is down.', status: 500 } } },
      },
    ]);

    const response = await context.app.request(`/v1/connections/${context.connection_id}/revoke`, {
      method: 'POST',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ connection_status: 'revoked' });
    const stored = await context.db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.connection_id, context.connection_id),
    });
    expect(stored?.connection_status).toBe('revoked');
  });
});

function post_provider_webhook(
  context: Awaited<ReturnType<typeof create_composio_setup_context>>,
  input: { provider_key: string; query?: string; body: unknown },
) {
  return context.app.request(
    `/v1/connections/providers/${input.provider_key}/webhook` +
      `?connection_id=${context.connection_id}${input.query ?? ''}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.body),
    },
  );
}

async function activate_composio_connection(
  context: Awaited<ReturnType<typeof create_composio_setup_context>>,
) {
  await start_hosted_setup(context);
  stub_composio_api([
    {
      path: '/connected_accounts/ca_attio_test',
      respond: { body: connected_account({ status: 'ACTIVE' }) },
    },
    ...identity_probe_routes({ endpoint: null }),
  ]);

  const response = await context.app.request(
    `/v1/connections/setup/complete?connection_id=${context.connection_id}` +
      `&setup_token=${context.setup_state.setup_token}`,
    { method: 'POST' },
  );
  if (response.status !== 200) {
    throw new Error(`Hosted setup completion failed: ${await response.text()}`);
  }
  reset_composio_client_for_tests();
}

async function start_hosted_setup(
  context: Awaited<ReturnType<typeof create_composio_setup_context>>,
) {
  stub_composio_api([
    { path: '/auth_configs', respond: { body: { items: [], next_cursor: null } } },
    {
      path: '/auth_configs',
      respond: {
        body: {
          toolkit: { slug: 'attio' },
          auth_config: { id: 'ac_created', auth_scheme: 'OAUTH2', is_composio_managed: true },
        },
      },
    },
    {
      path: '/connected_accounts/link',
      respond: {
        body: {
          link_token: 'lt_test',
          redirect_url: 'https://backend.composio.dev/s/connect/link_test',
          expires_at: '2026-09-14T00:00:00.000Z',
          connected_account_id: 'ca_attio_test',
        },
      },
    },
  ]);

  const response = await context.app.request(
    `/v1/connections/setup/start?connection_id=${context.connection_id}` +
      `&setup_token=${context.setup_state.setup_token}`,
  );
  if (response.status !== 200) {
    throw new Error(`Hosted setup start failed: ${await response.text()}`);
  }
  reset_composio_client_for_tests();
}

async function insert_composio_test_app(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: { provider_key?: string } = {},
) {
  const provider_key = input.provider_key ?? 'composio';
  const [app] = await db
    .insert(apps)
    .values({
      app_id: create_id(id_prefixes.app),
      app_name: 'attio',
      app_key: 'attio',
      catalog_scope: 'global',
      app_display_name: 'Attio',
      auth_type: 'oauth2',
      app_status: 'active',
      display_config: {},
      metadata: {
        provider_configs: [
          {
            provider_key,
            provider_config_key: `${provider_key}:attio`,
            version: 1,
            status: 'active',
            provider_app_key: 'attio',
            setup_defaults: {},
            connection_profiles: [
              {
                connection_profile_key: `${provider_key}:attio:oauth2`,
                version: 1,
                status: 'active',
                auth_method_key: 'composio_managed_oauth',
                setup_strategy: {
                  type: 'hosted_connect_link',
                  auth_scheme: 'OAUTH2',
                  auth_config_source: 'composio_managed',
                  connected_account_fields: [],
                },
                runtime_credential_strategy: {
                  type: 'provider_account_reference',
                  send_to_provider_as: 'connected_account_id',
                },
                default_scopes: [],
              },
            ],
          },
        ],
      },
      created_by: 'test',
      last_updated_by: 'test',
    })
    .returning();
  if (!app) throw new Error('app insert failed');
  return app;
}
