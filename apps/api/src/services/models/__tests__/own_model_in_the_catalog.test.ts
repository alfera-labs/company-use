import { afterEach, describe, expect, it, vi } from 'vitest';

const model_key_env_names = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_OAUTH_TOKEN',
  'VERCEL_AI_GATEWAY_API_KEY',
  'OPENAI_CODEX_ACCESS_TOKEN',
];

async function load_model_catalog_of_an_install(settings: Record<string, string>) {
  for (const env_name of model_key_env_names) vi.stubEnv(env_name, '');
  for (const [env_name, value] of Object.entries(settings)) vi.stubEnv(env_name, value);
  vi.resetModules();
  return import('@api/services/models/model_catalog');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the model list of a self-hosted install that names its own model address', () => {
  it('offers the model the operator named, with no price and nothing made up about it', async () => {
    const { list_models } = await load_model_catalog_of_an_install({
      COWORKER_SELF_HOSTED: 'true',
      OPENAI_COMPATIBLE_BASE_URL: 'http://host.docker.internal:11434/v1',
      OPENAI_COMPATIBLE_MODEL: 'qwen3:14b',
    });

    expect(await list_models()).toEqual([
      {
        model_id: 'qwen3:14b',
        model_display_name: 'qwen3:14b',
        model_family: null,
        release_date: null,
        model_provider: 'openai_compatible',
        model_provider_display_name: 'Your own model',
        model_provider_logo_url: null,
        model_proxy: 'openai_compatible',
        model_proxy_display_name: 'Your own model',
        description: null,
        context_window: 32_768,
        max_output_tokens: null,
        model_type: 'language',
        input_modalities: ['text'],
        output_modalities: ['text'],
        supports_tool_calls: true,
        supports_reasoning: false,
        speed_out_of_five: null,
        intelligence_out_of_five: null,
        is_recommended_for_agent_runs: true,
      },
    ]);
  });

  it('is not offered by the hosted product, whatever its environment holds', async () => {
    const { list_models } = await load_model_catalog_of_an_install({
      COWORKER_SELF_HOSTED: 'false',
      OPENAI_COMPATIBLE_BASE_URL: 'http://host.docker.internal:11434/v1',
      OPENAI_COMPATIBLE_MODEL: 'qwen3:14b',
    });

    await expect(list_models()).rejects.toMatchObject({
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
  });
});
