import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { find_or_create_alfera_api_connection } from '@coworker/core/db/queries/alfera_api_connection';
import {
  type ApiKey,
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

async function mint_key(
  scopes: ApiKeyScope[] = ['integrations.read'],
  key_audience: ApiKeyAudience = 'internal',
): Promise<{ api_key: ApiKey; secret: string }> {
  return create_api_key(db, {
    workspace_id,
    key_name: 'integrations key',
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
}

function key_headers(secret: string) {
  return { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
}

async function seed_connected_integration() {
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: 'payments_app',
    app_key: 'payments_app',
    catalog_scope: 'global',
    app_display_name: 'Payments',
    auth_type: 'oauth2',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(nodes).values({
    node_id: create_id(id_prefixes.node),
    app_id,
    app_key: 'payments_app',
    node_name: 'send_payout',
    catalog_scope: 'global',
    node_key: 'payments_app-send_payout-1',
    node_version: 1,
    node_display_name: 'Send payout',
    node_kind: 'tool',
    input_schema: {
      type: 'object',
      properties: { amount: { type: 'number' }, memo: { type: 'string' } },
      required: ['amount'],
    },
    output_schema: { type: 'object', properties: {} },
    approval_policy: { mode: 'manual_review' },
    runtime_handler: 'payments.send_payout',
    node_runtime: 'native_tool',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'native',
    provider_config_key: 'native:payments_app',
    provider_config_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: {},
    metadata: { description: 'Send money to a payee.' },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  const connection_id = create_id(id_prefixes.connection);
  await db.insert(connections).values({
    connection_id,
    workspace_id,
    app_id,
    connection_key: 'native:payments_app:main',
    connection_name: 'Payments prod',
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: 'native:payments_app',
    provider_config_version: 1,
    auth_method_key: 'oauth2',
    external_account_id: 'acct_secret_123',
    authorized_scopes: ['payments:write'],
    health_status: 'healthy',
    connection_config: { access: { type: 'shared' } },
    setup_state: { secret_token: 'super-secret-oauth-token' },
    provider_account: { access_token: 'tok_live_should_never_leak' },
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  return { connection_id, app_id };
}

async function get_json(path: string, secret: string) {
  const response = await app.request(path, { headers: key_headers(secret) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('public integrations API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('lists connected integrations with only the safe fields, and a tool count', async () => {
    const { connection_id } = await seed_connected_integration();
    const { secret } = await mint_key();

    const { status, body } = await get_json('/v1/integrations', secret);
    const data = body.data as Record<string, unknown>[];

    expect(status).toBe(200);
    expect(data).toEqual([
      { integration_key: connection_id, name: 'Payments prod', kind: 'native', tool_count: 1 },
    ]);
    const leaked = JSON.stringify(data);
    for (const secret_marker of [
      'super-secret-oauth-token',
      'tok_live_should_never_leak',
      'acct_secret_123',
      'authorized_scopes',
      'setup_state',
      'provider_account',
      'connection_config',
    ]) {
      expect(leaked).not.toContain(secret_marker);
    }
  });

  it('leaves the built-in Alfera API connection out of the list', async () => {
    await find_or_create_alfera_api_connection(db, workspace_id);
    const { secret } = await mint_key();

    const { status, body } = await get_json('/v1/integrations', secret);

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('projects one integration’s tools: name, description, parameters, approval need', async () => {
    const { connection_id } = await seed_connected_integration();
    const { secret } = await mint_key();

    const { status, body } = await get_json(`/v1/integrations/${connection_id}/tools`, secret);
    const data = body.data as {
      name: string;
      description: string | null;
      parameters: { name: string; type: string; required: boolean }[];
      requires_approval: boolean;
    }[];

    expect(status).toBe(200);
    expect(data).toHaveLength(1);
    const tool = data[0];
    expect(tool?.name).toBe('payments_app-send_payout-1');
    expect(tool?.description).toBe('Send money to a payee.');
    expect(tool?.requires_approval).toBe(true);
    expect(tool?.parameters).toEqual(
      expect.arrayContaining([
        { name: 'amount', type: 'number', required: true },
        { name: 'memo', type: 'string', required: false },
      ]),
    );
  });

  it('does not find a connection from another workspace', async () => {
    const { connection_id } = await seed_connected_integration();
    const other_key = await create_api_key(db, {
      workspace_id: 'ws_other_workspace',
      key_name: 'other',
      scopes: ['integrations.read'],
      key_audience: 'internal',
      environment_label: 'test',
      actor_id: 'user_other',
    });

    const list = await get_json('/v1/integrations', other_key.secret);
    const tools = await get_json(`/v1/integrations/${connection_id}/tools`, other_key.secret);

    expect((list.body.data as unknown[]).length).toBe(0);
    expect(tools.status).toBe(404);
    expect((tools.body.error as { code: string }).code).toBe('not_found');
  });

  it('refuses a key that lacks integrations.read', async () => {
    await seed_connected_integration();
    const { secret } = await mint_key(['agents.read']);

    const { status, body } = await get_json('/v1/integrations', secret);

    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe('scope_missing');
  });

  it('refuses an external-audience key even when it holds integrations.read', async () => {
    await seed_connected_integration();
    const { secret } = await mint_key(['integrations.read'], 'external');

    const { status, body } = await get_json('/v1/integrations', secret);

    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe('scope_missing');
  });
});
