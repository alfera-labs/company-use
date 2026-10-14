import { create_app } from '@api/app';
import { clear_model_catalog_cache } from '@api/services/models/model_catalog';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_agent } from '@coworker/core/db/queries/sessions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  clear_model_catalog_cache();
  set_model_key('OPENAI_API_KEY', undefined);
  set_model_key('ANTHROPIC_API_KEY', undefined);
  set_model_key('ANTHROPIC_OAUTH_TOKEN', undefined);
  set_model_key('VERCEL_AI_GATEWAY_API_KEY', 'test_gateway_key');
});

afterEach(() => {
  set_model_key('VERCEL_AI_GATEWAY_API_KEY', undefined);
  set_model_key('OPENAI_API_KEY', undefined);
  vi.unstubAllGlobals();
});

describe('PATCH /v1/agents/:agent_id', () => {
  it('stores the model provider and proxy in their canonical persistence fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(models_dev_response(['anthropic/claude-opus-4.8'])),
    );
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_model: {
          model_provider: 'anthropic',
          model_proxy: 'vercel_ai_gateway',
          model_name: 'anthropic/claude-opus-4.8',
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.default_model_route).toEqual({
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'anthropic/claude-opus-4.8',
    });
    expect(body.data).toMatchObject({
      default_model: 'anthropic/claude-opus-4.8',
      default_model_provider: 'anthropic',
      default_model_name: 'anthropic/claude-opus-4.8',
    });
    expect(await get_agent(db, bootstrap.workspace_id, bootstrap.agent_id)).toMatchObject({
      default_model: 'anthropic/claude-opus-4.8',
      default_model_provider: 'anthropic',
      default_model_name: 'anthropic/claude-opus-4.8',
      agent_config: { model_proxy: 'vercel_ai_gateway' },
    });
  });

  it('stores a model served directly by its provider', async () => {
    set_model_key('VERCEL_AI_GATEWAY_API_KEY', undefined);
    set_model_key('OPENAI_API_KEY', 'test_openai_key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(models_dev_response(['openai/gpt-5.5'])));
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_model: {
          model_provider: 'openai',
          model_proxy: 'openai',
          model_name: 'gpt-5.5',
        },
      }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data.default_model_route).toEqual({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.5',
    });
  });

  it('clears the pinned model so the platform recommends one again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(models_dev_response(['openai/gpt-5.5'])));
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_model: {
          model_provider: 'openai',
          model_proxy: 'vercel_ai_gateway',
          model_name: 'openai/gpt-5.5',
        },
      }),
    });
    const response = await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_model: null }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.default_model).toBeNull();
    expect(body.data.default_model_route).toBeNull();
    const stored = await get_agent(db, bootstrap.workspace_id, bootstrap.agent_id);
    expect(stored).toMatchObject({
      default_model: null,
      default_model_provider: null,
      default_model_name: null,
    });
    expect(stored?.agent_config).not.toHaveProperty('model_proxy');
  });

  it('rejects a model that its selected proxy cannot run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(models_dev_response(['openai/gpt-5.5'])));
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_model: {
          model_provider: 'zai',
          model_proxy: 'vercel_ai_gateway',
          model_name: 'zai/not-real',
        },
      }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toBe(
      'Model zai/not-real is not available through model proxy vercel_ai_gateway',
    );
  });

  it('does not save a model when its proxy has no credential', async () => {
    set_model_key('VERCEL_AI_GATEWAY_API_KEY', undefined);
    set_model_key('OPENAI_API_KEY', 'test_openai_key');
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_model: {
          model_provider: 'zai',
          model_proxy: 'vercel_ai_gateway',
          model_name: 'zai/glm-5.2',
        },
      }),
    });

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatchObject({
      code: 'model_proxy_not_configured',
      details: {
        model_proxy: 'vercel_ai_gateway',
        credential_env_names: ['VERCEL_AI_GATEWAY_API_KEY'],
      },
    });
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it('saves the agent prompt to the one column the runtime reads', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: 'You are the finance desk bot.' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.system_prompt).toBe('You are the finance desk bot.');
    expect(body.data).not.toHaveProperty('system_instructions');
    expect(await get_agent(db, bootstrap.workspace_id, bootstrap.agent_id)).toMatchObject({
      system_prompt: 'You are the finance desk bot.',
    });
  });

  it('accepts the retired system_instructions field as the prompt', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instructions: 'You answer billing questions only.' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data.system_prompt).toBe('You answer billing questions only.');
  });

  it('rejects a provider that does not provide the selected model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(models_dev_response(['zai/glm-5.2'])));
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request(`/v1/agents/${bootstrap.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_model: {
          model_provider: 'openai',
          model_proxy: 'vercel_ai_gateway',
          model_name: 'zai/glm-5.2',
        },
      }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: 'validation_error',
      message: 'Request body failed validation',
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            message: 'Model provider openai does not match model zai/glm-5.2.',
            path: ['default_model', 'model_provider'],
          }),
        ]),
      },
    });
  });
});

function models_dev_response(model_ids: string[]) {
  const vercel_models = Object.fromEntries(
    model_ids.map((model_id) => [model_id, model(model_id)]),
  );
  const openai_models = Object.fromEntries(
    model_ids
      .filter((model_id) => model_id.startsWith('openai/'))
      .map((model_id) => [model_id.slice(7), model(model_id.slice(7))]),
  );
  return Response.json({
    anthropic: { id: 'anthropic', name: 'Anthropic', models: {} },
    openai: { id: 'openai', name: 'OpenAI', models: openai_models },
    zai: { id: 'zai', name: 'Z.AI', models: {} },
    vercel: { id: 'vercel', name: 'Vercel', models: vercel_models },
  });
}

function model(model_id: string) {
  return {
    id: model_id,
    name: model_id,
    tool_call: true,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 200_000, output: 32_000 },
  };
}

function set_model_key(name: string, value: string | undefined) {
  Object.defineProperty(env, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
