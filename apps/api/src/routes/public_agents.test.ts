import { create_app } from '@api/app';
import { mint_workspace_api_key } from '@api/services/api_keys';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { find_or_create_alfera_api_connection } from '@coworker/core/db/queries/alfera_api_connection';
import {
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { find_agent_by_slug } from '@coworker/core/db/queries/sessions';
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
    key_name: `${key_audience} key`,
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
  return secret;
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

describe('public agents API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('discloses exactly the five public fields, and never the persona', async () => {
    const secret = await mint_key(['agents.read']);

    const response = await app.request('/v1/agents', {
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = (await response.json()) as { data: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    const agent = body.data[0];
    expect(agent).toBeDefined();
    expect(Object.keys(agent ?? {}).sort()).toEqual([
      'agent_id',
      'created_time',
      'description',
      'name',
      'slug',
    ]);
    expect(agent).not.toHaveProperty('system_prompt');
    expect(agent).not.toHaveProperty('default_model');
    expect(agent).not.toHaveProperty('agent_config');
  });

  it('reads one agent by slug and 404s an unknown one', async () => {
    const secret = await mint_key(['agents.read']);

    const found = await app.request('/v1/agents/main', {
      headers: { authorization: `Bearer ${secret}` },
    });
    const missing = await app.request('/v1/agents/nobody', {
      headers: { authorization: `Bearer ${secret}` },
    });

    expect(found.status).toBe(200);
    expect(((await found.json()) as { data: { slug: string } }).data.slug).toBe('main');
    expect(missing.status).toBe(404);
  });

  it('renames an agent and rewrites its instructions with agents.write', async () => {
    const { api_key, secret } = await create_api_key(db, {
      workspace_id,
      key_name: 'editor key',
      scopes: ['agents.write'],
      key_audience: 'internal',
      environment_label: 'test',
      actor_id,
    });
    await allow_api_tool('update_agent');

    const response = await app.request('/v1/agents/main', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ops', instructions: 'Answer in French.' }),
    });
    const body = (await response.json()) as { data: Record<string, unknown> };
    const stored = await find_agent_by_slug(db, workspace_id, 'main');

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('Ops');
    expect(body.data).not.toHaveProperty('system_prompt');
    expect(stored?.agent_name).toBe('Ops');
    expect(stored?.system_prompt).toBe('Answer in French.');
    expect(stored?.last_updated_by).toBe(api_key.api_key_id);
  });

  it('asks before a key rewrites an agent, until the Alfera API connection allows it', async () => {
    const writer = await mint_key(['agents.write']);

    const response = await app.request('/v1/agents/main', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${writer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'Answer in French.' }),
    });
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    const connection = await find_or_create_alfera_api_connection(db, workspace_id);

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('approval_required');
    expect(body.error.details).toMatchObject({
      tool: 'update_agent',
      policy_mode: 'ask',
      decided_by: [{ scope_type: 'connection', scope_id: connection.connection_id }],
    });
    expect((await find_agent_by_slug(db, workspace_id, 'main'))?.system_prompt).not.toBe(
      'Answer in French.',
    );
  });

  it('refuses an agent write to a read key, and an empty or unknown body', async () => {
    const reader = await mint_key(['agents.read']);
    const writer = await mint_key(['agents.write']);
    const patch = (secret: string, body: unknown) =>
      app.request('/v1/agents/main', {
        method: 'PATCH',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    await allow_api_tool('update_agent');

    expect((await patch(reader, { name: 'Ops' })).status).toBe(403);
    expect((await patch(writer, {})).status).toBe(422);
    expect((await patch(writer, { model: 'gpt' })).status).toBe(422);
    const missing = await app.request('/v1/agents/nobody', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${writer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ops' }),
    });
    expect(missing.status).toBe(404);
  });

  it('lets a request with no API key fall through to the dashboard route', async () => {
    const response = await app.request('/v1/agents');
    const body = (await response.json()) as { data: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(body.data[0]).toHaveProperty('system_prompt');
  });

  it('refuses to mint agents.read on an external-audience key', async () => {
    await expect(
      mint_workspace_api_key(db, {
        workspace_id,
        user_id: actor_id,
        key_name: 'widget key',
        scopes: ['agents.read'],
        key_audience: 'external',
      }),
    ).rejects.toMatchObject({ code: 'validation_error', status: 422 });
  });

  it('refuses an external key that already holds the scope', async () => {
    const secret = await mint_key(['agents.read'], 'external');

    const response = await app.request('/v1/agents', {
      headers: { authorization: `Bearer ${secret}` },
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'scope_missing',
    );
  });
});
