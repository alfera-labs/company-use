import { create_app } from '@api/app';
import { clear_model_catalog_cache } from '@api/services/models/model_catalog';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ModelResponseEntry = Record<string, unknown> & {
  model_id: string;
  model_display_name: string;
};

beforeEach(() => {
  clear_model_catalog_cache();
  set_model_catalog_refresh(true);
  clear_model_keys();
  set_model_key('VERCEL_AI_GATEWAY_API_KEY', 'test_gateway_key');
});

afterEach(() => {
  clear_model_keys();
  vi.unstubAllGlobals();
});

describe('GET /v1/models', () => {
  it('intersects the proxy transport catalog with provider-neutral model metadata', async () => {
    const fetch_mock = vi.fn().mockResolvedValue(
      models_dev_response({
        'openai/gpt-5.5': models_dev_model('openai/gpt-5.5', 'GPT-5.5'),
        'zai/glm-5.2': models_dev_model('zai/glm-5.2', 'GLM-5.2'),
        'future/not-installed': models_dev_model('future/not-installed', 'Future'),
      }),
    );
    vi.stubGlobal('fetch', fetch_mock);
    const app = create_app(await create_test_database());

    const { response, body } = await list_models_after_refresh(app, 'zai/glm-5.2');

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        model_id: 'openai/gpt-5.5',
        model_display_name: 'GPT-5.5',
        model_family: 'gpt',
        release_date: null,
        model_provider: 'openai',
        model_provider_display_name: 'OpenAI',
        model_provider_logo_url: 'https://models.dev/logos/openai.svg',
        model_proxy: 'vercel_ai_gateway',
        model_proxy_display_name: 'Vercel AI Gateway',
        description: 'Model description',
        context_window: 200_000,
        max_output_tokens: 32_000,
        model_type: 'language',
        input_modalities: ['text'],
        output_modalities: ['text'],
        supports_tool_calls: true,
        supports_reasoning: true,
        speed_out_of_five: 3,
        intelligence_out_of_five: 4,
        is_recommended_for_agent_runs: false,
        keys_that_unlock_this_model: [],
      },
      expect.objectContaining({ model_id: 'zai/glm-5.2', model_provider: 'zai' }),
    ]);
    expect(fetch_mock).toHaveBeenCalledWith(
      'https://models.dev/api.json',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('offers one row per model even when the two catalogs spell its name differently', async () => {
    set_model_key('OPENAI_API_KEY', 'test_openai_key');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          models_dev_response(
            { 'openai/gpt-5.5': models_dev_model('openai/gpt-5.5', 'GPT 5.5') },
            { 'gpt-5.5': models_dev_model('gpt-5.5', 'GPT-5.5') },
          ),
        ),
    );
    const app = create_app(await create_test_database());

    const { response, body } = await list_models_after_refresh(app, 'gpt-5.5');
    const models = body.data as Array<Record<string, string>>;

    expect(response.status).toBe(200);
    expect(
      models
        .filter((model) => model.model_provider === 'openai')
        .map((model) => [model.model_proxy, model.model_id]),
    ).toEqual([['openai_direct', 'gpt-5.5']]);
  });

  it('offers a model provider through the gateway when its direct proxy has no credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          models_dev_response(
            { 'openai/gpt-5.5': models_dev_model('openai/gpt-5.5', 'GPT 5.5') },
            { 'gpt-5.5': models_dev_model('gpt-5.5', 'GPT-5.5') },
          ),
        ),
    );
    const app = create_app(await create_test_database());

    const { body } = await list_models_after_refresh(app, 'openai/gpt-5.5');

    expect(
      body.data
        .filter((model) => model.model_provider === 'openai')
        .map((model) => [model.model_proxy, model.model_id]),
    ).toEqual([['vercel_ai_gateway', 'openai/gpt-5.5']]);
  });

  it('marks the model an agent run reaches for when nobody pinned one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        models_dev_response({
          'openai/gpt-5.5': models_dev_model('openai/gpt-5.5', 'GPT-5.5'),
          'zai/glm-4.6': models_dev_model('zai/glm-4.6', 'GLM-4.6'),
        }),
      ),
    );
    const app = create_app(await create_test_database());

    const { body } = await list_models_after_refresh(app, 'zai/glm-4.6');
    const models = body.data as Array<Record<string, unknown>>;

    expect(
      models.filter((model) => model.is_recommended_for_agent_runs).map((model) => model.model_id),
    ).toEqual(['zai/glm-4.6']);
  });

  it('shares one in-flight refresh across repeated requests', async () => {
    const fetch_mock = vi
      .fn()
      .mockResolvedValue(
        models_dev_response({ 'openai/gpt-5.5': models_dev_model('openai/gpt-5.5') }),
      );
    vi.stubGlobal('fetch', fetch_mock);
    const app = create_app(await create_test_database());

    const [first_response, second_response] = await Promise.all([
      app.request('/v1/models'),
      app.request('/v1/models'),
    ]);

    expect(first_response.status).toBe(200);
    expect(second_response.status).toBe(200);
    expect(fetch_mock).toHaveBeenCalledTimes(1);
  });

  it('returns the bundled catalog without waiting for a slow refresh', async () => {
    const fetch_mock = vi.fn().mockReturnValue(new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetch_mock);
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/models');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    expect(fetch_mock).toHaveBeenCalledTimes(1);
  });

  it('serves the bundled catalog and calls nobody when the refresh switch is off', async () => {
    set_model_catalog_refresh(false);
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/models');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it('returns a visible proxy error when no model credential is configured', async () => {
    clear_model_keys();
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/models');
    const error = (await response.json()).error;

    expect(response.status).toBe(503);
    expect(error).toMatchObject({
      code: 'model_proxy_not_configured',
      details: {
        model_proxies: [
          'vercel_ai_gateway',
          'anthropic_direct',
          'openai_codex',
          'openai_direct',
          'openrouter',
          'google_direct',
          'xai_direct',
          'deepseek_direct',
          'mistral_direct',
          'groq_direct',
          'moonshotai_direct',
          'minimax_direct',
          'xiaomi_direct',
          'cerebras_direct',
          'together_direct',
          'fireworks_direct',
          'huggingface_direct',
        ],
      },
    });
    expect(error.details.credential_env_names).toContain('VERCEL_AI_GATEWAY_API_KEY');
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it('omits models that cannot run agent tools', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        models_dev_response({
          'openai/gpt-5.5': models_dev_model('openai/gpt-5.5', 'GPT-5.5', false),
          'zai/glm-5.2': models_dev_model('zai/glm-5.2', 'GLM-5.2'),
        }),
      ),
    );
    const app = create_app(await create_test_database());

    const { response, body } = await list_models_after_refresh(app, 'zai/glm-5.2');

    expect(response.status).toBe(200);
    expect(body.data.map((model) => model.model_id)).toEqual(['zai/glm-5.2']);
  });

  it('serves the bundled last-known catalog when models.dev is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/models');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_id: 'openai/gpt-5.5',
          model_proxy: 'vercel_ai_gateway',
        }),
      ]),
    );
  });

  it('serves the bundled last-known catalog when models.dev returns invalid data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ invalid: true })));
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/models');

    expect(response.status).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  it('refreshes from a mixed feed containing non-language models with zero token limits', async () => {
    const payload = (await models_dev_response({
      'zai/glm-5.2': models_dev_model('zai/glm-5.2', 'GLM refreshed'),
    }).json()) as Record<string, unknown>;
    payload.media = {
      id: 'media',
      name: 'Media',
      models: {
        image: {
          id: 'image',
          name: 'Image generator',
          modalities: { input: ['text'], output: ['image'] },
          limit: { context: 0, output: 0 },
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
    const app = create_app(await create_test_database());

    const { body } = await list_models_after_refresh(app, 'zai/glm-5.2');

    expect(body.data.find((model) => model.model_id === 'zai/glm-5.2')).toMatchObject({
      model_display_name: 'GLM refreshed',
    });
  });
});

async function list_models_after_refresh(
  app: ReturnType<typeof create_app>,
  model_id: string,
): Promise<{ response: Response; body: { data: ModelResponseEntry[] } }> {
  await app.request('/v1/models');
  let result: { response: Response; body: { data: ModelResponseEntry[] } } | undefined;

  await vi.waitFor(async () => {
    const response = await app.request('/v1/models');
    const body = (await response.json()) as { data: ModelResponseEntry[] };
    expect(body.data.some((model) => model.model_id === model_id)).toBe(true);
    result = { response, body };
  });

  if (!result) throw new Error(`Model catalog refresh did not publish ${model_id}`);
  return result;
}

type ModelsDevModels = Record<string, ReturnType<typeof models_dev_model>>;

function models_dev_response(
  vercel_models: ModelsDevModels,
  openai_models: ModelsDevModels = strip_gateway_prefix(vercel_models),
) {
  return Response.json({
    openai: { id: 'openai', name: 'OpenAI', models: openai_models },
    zai: { id: 'zai', name: 'Z.AI', models: {} },
    vercel: { id: 'vercel', name: 'Vercel', models: vercel_models },
  });
}

function strip_gateway_prefix(vercel_models: ModelsDevModels): ModelsDevModels {
  return Object.fromEntries(
    Object.entries(vercel_models)
      .filter(([model_id]) => model_id.startsWith('openai/'))
      .map(([model_id, model]) => {
        const bare_model_id = model_id.slice('openai/'.length);
        return [bare_model_id, { ...model, id: bare_model_id }];
      }),
  );
}

function models_dev_model(model_id: string, name = model_id, tool_call = true) {
  return {
    id: model_id,
    name,
    family:
      model_id
        .split('/')
        .at(-1)
        ?.split(/[-.\d]/u)[0] || 'gpt',
    description: 'Model description',
    reasoning: true,
    tool_call,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 200_000, output: 32_000 },
  };
}

function clear_model_keys() {
  set_model_key('VERCEL_AI_GATEWAY_API_KEY', undefined);
  set_model_key('OPENAI_CODEX_ACCESS_TOKEN', undefined);
  set_model_key('OPENAI_API_KEY', undefined);
  set_model_key('ANTHROPIC_API_KEY', undefined);
  set_model_key('ANTHROPIC_OAUTH_TOKEN', undefined);
}

function set_model_catalog_refresh(value: boolean) {
  Object.defineProperty(env, 'MODEL_CATALOG_REFRESH', {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function set_model_key(name: string, value: string | undefined) {
  Object.defineProperty(env, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
