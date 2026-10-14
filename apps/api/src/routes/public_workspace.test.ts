import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { find_or_create_alfera_api_connection } from '@coworker/core/db/queries/alfera_api_connection';
import {
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { find_workspace_profile } from '@coworker/core/db/queries/workspace_provisioning';
import { build_alfera_api_node_key } from '@coworker/core/integrations/alfera_api_tools';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

async function mint_key(scopes: ApiKeyScope[], key_audience: ApiKeyAudience = 'internal') {
  const { secret } = await create_api_key(db, {
    workspace_id,
    key_name: 'workspace key',
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
  return secret;
}

async function call(secret: string, method: string, body?: unknown) {
  const response = await app.request('/v1/workspace', {
    method,
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as { data: never } };
}

async function allow_api_tool(tool_name: string) {
  const connection = await find_or_create_alfera_api_connection(db, workspace_id);
  const response = await app.request('/v1/policies', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scope_type: 'connection',
      scope_id: connection.connection_id,
      resource_type: 'node',
      resource_id: build_alfera_api_node_key(tool_name),
      policy_mode: 'allow',
    }),
  });
  expect(response.status).toBe(200);
}

describe('public workspace API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('reads the workspace as three public fields', async () => {
    const read = await call(await mint_key(['workspace.read']), 'GET');

    expect(read.status).toBe(200);
    expect(Object.keys(read.body.data).sort()).toEqual(['name', 'slug', 'workspace_id']);
    expect(read.body.data).toMatchObject({ workspace_id });
  });

  it('asks before a key renames the workspace, until the Alfera API connection allows it', async () => {
    const refused = await call(await mint_key(['workspace.write']), 'PATCH', { name: 'Northwind' });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      error: { code: 'approval_required', details: { tool: 'rename_workspace' } },
    });
    expect((await find_workspace_profile(db, workspace_id))?.workspace_name).not.toBe('Northwind');
  });

  it('renames the workspace with workspace.write, and never with a read key', async () => {
    await allow_api_tool('rename_workspace');
    const renamed = await call(await mint_key(['workspace.write']), 'PATCH', { name: 'Northwind' });
    const refused = await call(await mint_key(['workspace.read']), 'PATCH', { name: 'Nope' });

    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: 'Northwind' });
    expect((await find_workspace_profile(db, workspace_id))?.workspace_name).toBe('Northwind');
    expect(refused.status).toBe(403);
  });

  it('refuses an external key and an unknown field', async () => {
    await allow_api_tool('rename_workspace');
    const external = await call(await mint_key(['workspace.read'], 'external'), 'GET');
    const unknown = await call(await mint_key(['workspace.write']), 'PATCH', { plan: 'pro' });

    expect(external.status).toBe(403);
    expect(unknown.status).toBe(422);
  });

  it('lets a request with no API key fall through to the dashboard route', async () => {
    const response = await app.request('/v1/workspace');
    const body = (await response.json()) as { data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.data).toHaveProperty('onboarding_completed');
  });
});
