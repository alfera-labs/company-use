import { afterEach, describe, expect, it, vi } from 'vitest';

const model_key_env_names = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_OAUTH_TOKEN',
  'VERCEL_AI_GATEWAY_API_KEY',
  'OPENAI_CODEX_ACCESS_TOKEN',
];

async function load_resolver_of_an_install(settings: Record<string, string>) {
  for (const env_name of model_key_env_names) vi.stubEnv(env_name, '');
  vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', 'http://host.docker.internal:11434/v1');
  vi.stubEnv('OPENAI_COMPATIBLE_MODEL', 'qwen3:14b');
  for (const [env_name, value] of Object.entries(settings)) vi.stubEnv(env_name, value);
  vi.resetModules();
  return import('@runtime-platform/model_resolver');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('a run on a self-hosted install that names its own model address', () => {
  it('runs on the operator model, with the deployment as the origin of the credential', async () => {
    const { resolve_model } = await load_resolver_of_an_install({ COWORKER_SELF_HOSTED: 'true' });

    expect(resolve_model()).toEqual({
      model_provider: 'openai_compatible',
      model_proxy: 'openai_compatible',
      model_name: 'qwen3:14b',
      reasoning_level: 'medium',
      credential_env_name: 'OPENAI_COMPATIBLE_API_KEY',
      credential_origin: 'deployment',
    });
  });

  it('runs on the model the operator names now, not on the name an agent was saved with', async () => {
    const { resolve_model } = await load_resolver_of_an_install({ COWORKER_SELF_HOSTED: 'true' });

    expect(
      resolve_model({
        default_model_provider: 'openai_compatible',
        default_model_name: 'llama3.1:8b',
        agent_config: { model_proxy: 'openai_compatible' },
      }),
    ).toMatchObject({ model_proxy: 'openai_compatible', model_name: 'qwen3:14b' });
  });

  it('moves an agent that was saved on a cloud model whose key is gone', async () => {
    const { resolve_model } = await load_resolver_of_an_install({ COWORKER_SELF_HOSTED: 'true' });

    expect(
      resolve_model({
        default_model_provider: 'anthropic',
        default_model_name: 'claude-opus-5-5',
        agent_config: { model_proxy: 'anthropic_direct' },
      }),
    ).toMatchObject({ model_proxy: 'openai_compatible', model_name: 'qwen3:14b' });
  });
});

describe('the hosted product, when its environment holds a model address', () => {
  it('does not know the proxy when a request names it', async () => {
    const { resolve_model } = await load_resolver_of_an_install({
      COWORKER_SELF_HOSTED: 'false',
      OPENAI_API_KEY: 'test_openai_key',
    });

    expect(() =>
      resolve_model({ model_proxy: 'openai_compatible', model_name: 'qwen3:14b' }),
    ).toThrow('Unknown model proxy: openai_compatible.');
  });

  it('runs where it ran before', async () => {
    const { resolve_model } = await load_resolver_of_an_install({
      COWORKER_SELF_HOSTED: 'false',
      OPENAI_API_KEY: 'test_openai_key',
    });

    expect(resolve_model()).toMatchObject({
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.6-luna',
    });
  });
});
