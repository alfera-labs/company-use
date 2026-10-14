import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('resolve_model', () => {
  it('fails when no proxy credentials exist', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(() =>
      resolve_model({
        default_model: 'old-local-model',
        default_model_provider: 'local',
        default_model_name: 'old-local-model',
      }),
    ).toThrow(
      'No model proxy API key configured. Set OPENAI_CODEX_ACCESS_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_OAUTH_TOKEN, GEMINI_API_KEY, XAI_API_KEY, DEEPSEEK_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, MOONSHOT_API_KEY, MINIMAX_API_KEY, XIAOMI_API_KEY, CEREBRAS_API_KEY, TOGETHER_API_KEY, FIREWORKS_API_KEY, HF_TOKEN, VERCEL_AI_GATEWAY_API_KEY, OPENROUTER_API_KEY.',
    );
  });

  it('uses OpenAI credentials over the local placeholder agent default', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        default_model: 'old-local-model',
        default_model_provider: 'local',
        default_model_name: 'old-local-model',
      }),
    ).toEqual({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      credential_env_name: 'OPENAI_API_KEY',
      credential_origin: 'deployment',
      model_name: 'gpt-5.6-luna',
      reasoning_level: 'medium',
    });
  });

  it('uses OPENAI_MODEL when provided', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.stubEnv('OPENAI_MODEL', 'gpt-5.4-mini');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        default_model: 'old-local-model',
        default_model_provider: 'local',
        default_model_name: 'old-local-model',
      }),
    ).toEqual({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      credential_env_name: 'OPENAI_API_KEY',
      credential_origin: 'deployment',
      model_name: 'gpt-5.4-mini',
      reasoning_level: 'medium',
    });
  });

  it('reads consistently named model fields from one validated agent config', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        agent_config: {
          model_provider: 'openai',
          model_proxy: 'openai_direct',
          model_name: 'gpt-5.5',
          reasoning_level: 'medium',
          temperature: 0.2,
          max_output_tokens: 1200,
        },
      }),
    ).toEqual({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      credential_env_name: 'OPENAI_API_KEY',
      credential_origin: 'deployment',
      model_name: 'gpt-5.5',
      reasoning_level: 'medium',
      temperature: 0.2,
      max_output_tokens: 1200,
    });
  });

  it('rejects malformed model configuration at the resolver boundary', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    let validation_error: unknown;
    try {
      resolve_model({
        agent_config: {
          model_provider: 'openai',
          model_name: 'gpt-5.5',
          temperature: '0.2',
        },
      });
    } catch (error) {
      validation_error = error;
    }

    expect(validation_error).toMatchObject({
      issues: [{ path: ['agent_config', 'temperature'] }],
    });
  });

  it('uses gateway credentials over the local placeholder agent default', async () => {
    clear_model_proxy_env();
    vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', 'test_gateway_key');
    vi.stubEnv('VERCEL_AI_GATEWAY_MODEL', 'anthropic/claude-sonnet-5');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        default_model: 'old-local-model',
        default_model_provider: 'local',
        default_model_name: 'old-local-model',
      }),
    ).toEqual({
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      credential_env_name: 'VERCEL_AI_GATEWAY_API_KEY',
      credential_origin: 'deployment',
      model_name: 'anthropic/claude-sonnet-5',
      reasoning_level: 'medium',
    });
  });

  it('reads the model provider while the saved proxy serves the model', async () => {
    clear_model_proxy_env();
    vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', 'test_gateway_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        default_model: 'zai/glm-5.2',
        default_model_provider: 'zai',
        default_model_name: 'zai/glm-5.2',
        agent_config: { model_proxy: 'vercel_ai_gateway' },
      }),
    ).toEqual({
      model_provider: 'zai',
      model_proxy: 'vercel_ai_gateway',
      credential_env_name: 'VERCEL_AI_GATEWAY_API_KEY',
      credential_origin: 'deployment',
      model_name: 'zai/glm-5.2',
      reasoning_level: 'medium',
    });
  });

  it('reads the proxy from an agent row saved before the rename', async () => {
    clear_model_proxy_env();
    vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', 'test_gateway_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        default_model: 'zai/glm-5.2',
        default_model_provider: 'zai',
        default_model_name: 'zai/glm-5.2',
        agent_config: { model_proxy: 'ai_gateway' },
      }),
    ).toMatchObject({
      model_provider: 'zai',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'zai/glm-5.2',
    });
  });

  it('recovers provider and proxy from a previously persisted Vercel proxy row', async () => {
    clear_model_proxy_env();
    vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', 'test_gateway_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        default_model_provider: 'vercel_ai_gateway',
        default_model_name: 'anthropic/claude-opus-4.8',
      }),
    ).toMatchObject({
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'anthropic/claude-opus-4.8',
    });
  });

  it('does not inherit the saved proxy for a direct per-run model override', async () => {
    clear_model_proxy_env();
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', 'test_gateway_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        model_provider: 'openai',
        model_name: 'gpt-5.5',
        default_model_provider: 'anthropic',
        default_model_name: 'anthropic/claude-opus-4.8',
        agent_config: { model_proxy: 'vercel_ai_gateway' },
      }),
    ).toEqual({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      credential_env_name: 'OPENAI_API_KEY',
      credential_origin: 'deployment',
      model_name: 'gpt-5.5',
      reasoning_level: 'medium',
    });
  });

  it('rejects a provider that contradicts the explicit proxy and model', async () => {
    clear_model_proxy_env();
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(() =>
      resolve_model({
        model_provider: 'anthropic',
        model_proxy: 'openai_direct',
        model_name: 'gpt-5.5',
      }),
    ).toThrow('Model provider anthropic does not match model gpt-5.5.');
  });

  it('uses anthropic credentials when no openai or gateway key exists', async () => {
    clear_model_proxy_env();
    vi.stubEnv('ANTHROPIC_API_KEY', 'test_anthropic_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        default_model: 'old-local-model',
        default_model_provider: 'local',
        default_model_name: 'old-local-model',
      }),
    ).toEqual({
      model_provider: 'anthropic',
      model_proxy: 'anthropic_direct',
      credential_env_name: 'ANTHROPIC_API_KEY',
      credential_origin: 'deployment',
      model_name: 'claude-sonnet-5',
      reasoning_level: 'medium',
    });
  });

  it('preserves current Anthropic model ids from runtime input', async () => {
    clear_model_proxy_env();
    vi.stubEnv('ANTHROPIC_API_KEY', 'test_anthropic_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model({
        model_provider: 'anthropic',
        model_name: 'claude-fable-5',
      }),
    ).toEqual({
      model_provider: 'anthropic',
      model_proxy: 'anthropic_direct',
      credential_env_name: 'ANTHROPIC_API_KEY',
      credential_origin: 'deployment',
      model_name: 'claude-fable-5',
      reasoning_level: 'medium',
    });
  });

  it('fails when a configured provider has no API key', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(() =>
      resolve_model({
        default_model_provider: 'openai',
        default_model_name: 'gpt-5.5',
      }),
    ).toThrow('No API key configured for model proxy: openai_direct');
  });

  it('reports the missing credential env names for a requested proxy', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    let thrown_error: unknown;
    try {
      resolve_model({
        model_provider: 'zai',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'zai/glm-4.6',
      });
    } catch (error) {
      thrown_error = error;
    }

    expect(thrown_error).toMatchObject({
      code: 'model_proxy_not_configured',
      message:
        'No API key configured for model proxy: vercel_ai_gateway. Set VERCEL_AI_GATEWAY_API_KEY.',
      status: 500,
      details: {
        model_proxy: 'vercel_ai_gateway',
        credential_env_names: ['VERCEL_AI_GATEWAY_API_KEY'],
      },
    });
  });
});

describe('where the credential a run presents came from', () => {
  it('reports a workspace origin and carries the key when the workspace supplied it', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { model_provider: 'openai', model_proxy: 'openai_direct', model_name: 'gpt-5.5' },
        {
          environment: { OPENAI_API_KEY: 'sk-workspace-key' },
          workspace_owned_env_names: new Set(['OPENAI_API_KEY']),
        },
      ),
    ).toMatchObject({
      model_proxy: 'openai_direct',
      credential_env_name: 'OPENAI_API_KEY',
      credential_origin: 'workspace',
      api_key: 'sk-workspace-key',
    });
  });

  it('reports a workspace origin for a ChatGPT subscription token', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { model_provider: 'openai', model_proxy: 'openai_codex', model_name: 'gpt-5.6-luna' },
        {
          environment: { OPENAI_CODEX_ACCESS_TOKEN: 'chatgpt-access-token' },
          workspace_owned_env_names: new Set(['OPENAI_CODEX_ACCESS_TOKEN']),
        },
      ),
    ).toMatchObject({
      model_proxy: 'openai_codex',
      credential_env_name: 'OPENAI_CODEX_ACCESS_TOKEN',
      credential_origin: 'workspace',
      api_key: 'chatgpt-access-token',
    });
  });

  it('moves an agent saved onto our OpenAI account to the ChatGPT account the workspace connected', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { default_model_proxy: 'openai_direct', default_model_name: 'gpt-5.6-luna' },
        {
          environment: {
            OPENAI_CODEX_ACCESS_TOKEN: 'chatgpt-access-token',
            OPENAI_API_KEY: 'sk-deployment-key',
          },
          workspace_owned_env_names: new Set(['OPENAI_CODEX_ACCESS_TOKEN']),
        },
      ),
    ).toMatchObject({
      model_proxy: 'openai_codex',
      model_name: 'gpt-5.6-luna',
      credential_origin: 'workspace',
      api_key: 'chatgpt-access-token',
    });
  });

  it('keeps a saved model the subscription cannot serve off the subscription route', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    const model = resolve_model(
      { default_model_proxy: 'openai_direct', default_model_name: 'gpt-4.1-mini' },
      {
        environment: {
          OPENAI_CODEX_ACCESS_TOKEN: 'chatgpt-access-token',
          OPENAI_API_KEY: 'sk-deployment-key',
        },
        workspace_owned_env_names: new Set(['OPENAI_CODEX_ACCESS_TOKEN']),
      },
    );

    expect(model.model_proxy).toBe('openai_codex');
    expect(model.model_name).not.toBe('gpt-4.1-mini');
  });

  it('moves a run to a workspace account for another lab, on that lab’s own model', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    const resolved = resolve_model(
      { default_model_proxy: 'openai_direct', default_model_name: 'gpt-5.6-luna' },
      {
        environment: {
          ANTHROPIC_API_KEY: 'sk-ant-workspace',
          OPENAI_API_KEY: 'sk-deployment-key',
        },
        workspace_owned_env_names: new Set(['ANTHROPIC_API_KEY']),
      },
    );

    expect(resolved).toMatchObject({
      model_proxy: 'anthropic_direct',
      credential_env_name: 'ANTHROPIC_API_KEY',
      credential_origin: 'workspace',
    });
    expect(resolved.model_name).not.toBe('gpt-5.6-luna');
  });

  it('moves a run to a workspace gateway key', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { default_model_proxy: 'openai_direct', default_model_name: 'gpt-5.6-luna' },
        {
          environment: {
            VERCEL_AI_GATEWAY_API_KEY: 'vck-workspace',
            OPENAI_API_KEY: 'sk-deployment-key',
          },
          workspace_owned_env_names: new Set(['VERCEL_AI_GATEWAY_API_KEY']),
        },
      ),
    ).toMatchObject({
      model_proxy: 'vercel_ai_gateway',
      credential_env_name: 'VERCEL_AI_GATEWAY_API_KEY',
      credential_origin: 'workspace',
    });
  });

  it('keeps the agent’s own model when the workspace key serves the same provider', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { default_model_proxy: 'openai_direct', default_model_name: 'gpt-5.6-luna' },
        {
          environment: {
            ANTHROPIC_API_KEY: 'sk-ant-workspace',
            OPENAI_API_KEY: 'sk-workspace-openai',
          },
          workspace_owned_env_names: new Set(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']),
        },
      ),
    ).toMatchObject({
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.6-luna',
      credential_origin: 'workspace',
    });
  });

  it('leaves a route chosen on this request exactly where it was asked to go', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { model_provider: 'openai', model_proxy: 'openai_direct', model_name: 'gpt-5.5' },
        {
          environment: {
            OPENAI_CODEX_ACCESS_TOKEN: 'chatgpt-access-token',
            OPENAI_API_KEY: 'sk-deployment-key',
          },
          workspace_owned_env_names: new Set(['OPENAI_CODEX_ACCESS_TOKEN']),
        },
      ),
    ).toMatchObject({ model_proxy: 'openai_direct', credential_origin: 'deployment' });
  });

  it('never routes a bare model name to a ChatGPT subscription', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { model_name: 'gpt-5.6-luna' },
        {
          environment: {
            OPENAI_CODEX_ACCESS_TOKEN: 'chatgpt-access-token',
            OPENAI_API_KEY: 'sk-deployment-key',
          },
          workspace_owned_env_names: new Set(['OPENAI_CODEX_ACCESS_TOKEN']),
        },
      ),
    ).toMatchObject({ model_proxy: 'openai_direct', credential_origin: 'deployment' });
  });

  it('reports a deployment origin and carries no key when the deployment supplied it', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    const model = resolve_model(
      { model_provider: 'openai', model_proxy: 'openai_direct', model_name: 'gpt-5.5' },
      {
        environment: { OPENAI_API_KEY: 'sk-deployment-key' },
        workspace_owned_env_names: new Set<string>(),
      },
    );

    expect(model.credential_origin).toBe('deployment');
    expect(model).not.toHaveProperty('api_key');
  });

  it('hands the workspace key to the engine and keeps it out of anything written down', async () => {
    const { resolve_runtime_model_api_key } = await import('@agent-core/engines/pi/pi_model');
    const { model_config_without_credential } = await import(
      '@agent-core/models/runtime_model_config'
    );
    const model = {
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.5',
      api_key: 'sk-workspace-key',
    };

    expect(resolve_runtime_model_api_key(model)).toBe('sk-workspace-key');
    expect(model_config_without_credential(model)).not.toHaveProperty('api_key');
  });

  it('falls back to the process environment for a model config carrying no key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-deployment-key');
    vi.resetModules();
    const { resolve_runtime_model_api_key } = await import('@agent-core/engines/pi/pi_model');

    expect(
      resolve_runtime_model_api_key({
        model_provider: 'openai',
        model_proxy: 'openai_direct',
        model_name: 'gpt-5.5',
      }),
    ).toBe('sk-deployment-key');
  });
});

describe('the models a run is allowed to reach', () => {
  const every_credential = {
    OPENAI_CODEX_ACCESS_TOKEN: 'chatgpt-access-token',
    OPENAI_API_KEY: 'sk-deployment-key',
    ANTHROPIC_API_KEY: 'sk-ant-deployment',
    VERCEL_AI_GATEWAY_API_KEY: 'vck-deployment',
  };
  const locked = { model_access: 'openai_only', gateway_models_enabled: false } as const;
  const converted = { model_access: 'all', gateway_models_enabled: false } as const;
  const converted_with_gateway = { model_access: 'all', gateway_models_enabled: true } as const;

  async function resolve_with_every_credential(input: Record<string, unknown>) {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    return resolve_model(input, {
      environment: every_credential,
      workspace_owned_env_names: new Set(),
    });
  }

  it('moves a locked workspace off an explicitly chosen Claude, without failing the run', async () => {
    expect(
      await resolve_with_every_credential({
        model_provider: 'anthropic',
        model_proxy: 'anthropic_direct',
        model_name: 'claude-sonnet-5',
        model_access: locked,
      }),
    ).toMatchObject({
      model_provider: 'openai',
      model_proxy: 'openai_codex',
      model_name: 'gpt-5.6-luna',
    });
  });

  it('moves a locked workspace off a saved agent default on the gateway', async () => {
    expect(
      await resolve_with_every_credential({
        default_model_proxy: 'vercel_ai_gateway',
        default_model_name: 'zai/glm-4.6',
        model_access: locked,
      }),
    ).toMatchObject({ model_provider: 'openai', model_name: 'gpt-5.6-luna' });
  });

  it('leaves a locked workspace on the OpenAI model it asked for', async () => {
    expect(
      await resolve_with_every_credential({
        model_provider: 'openai',
        model_proxy: 'openai_direct',
        model_name: 'gpt-5.5',
        model_access: locked,
      }),
    ).toMatchObject({ model_proxy: 'openai_direct', model_name: 'gpt-5.5' });
  });

  it('keeps a locked workspace on its own ChatGPT subscription', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { model_access: locked },
        {
          environment: every_credential,
          workspace_owned_env_names: new Set(['OPENAI_CODEX_ACCESS_TOKEN']),
        },
      ),
    ).toMatchObject({ model_proxy: 'openai_codex', credential_origin: 'workspace' });
  });

  it('does not route a locked workspace to its own Anthropic key', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        { model_access: locked },
        {
          environment: every_credential,
          workspace_owned_env_names: new Set(['ANTHROPIC_API_KEY']),
        },
      ),
    ).toMatchObject({ model_provider: 'openai' });
  });

  it('gives a converted workspace the Claude it asked for', async () => {
    expect(
      await resolve_with_every_credential({
        model_provider: 'anthropic',
        model_proxy: 'anthropic_direct',
        model_name: 'claude-sonnet-5',
        model_access: converted,
      }),
    ).toMatchObject({ model_proxy: 'anthropic_direct', model_name: 'claude-sonnet-5' });
  });

  it('moves a converted workspace off a gateway model while the gateway is locked', async () => {
    expect(
      await resolve_with_every_credential({
        model_provider: 'zai',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'zai/glm-4.6',
        model_access: converted,
      }),
    ).toMatchObject({ model_provider: 'openai', model_name: 'gpt-5.6-luna' });
  });

  it('honours a gateway model once the gateway is unlocked', async () => {
    expect(
      await resolve_with_every_credential({
        model_provider: 'zai',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'zai/glm-4.6',
        model_access: converted_with_gateway,
      }),
    ).toMatchObject({ model_proxy: 'vercel_ai_gateway', model_name: 'zai/glm-4.6' });
  });

  it('leaves resolution alone when no access rules are given', async () => {
    expect(await resolve_with_every_credential({ model_name: 'claude-sonnet-5' })).toMatchObject({
      model_proxy: 'anthropic_direct',
      model_name: 'claude-sonnet-5',
    });
  });

  it('thinks at medium while a person waits and at high when nobody is', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(resolve_model({}).reasoning_level).toBe('medium');
    expect(resolve_model({ nobody_is_waiting: false }).reasoning_level).toBe('medium');
    expect(resolve_model({ nobody_is_waiting: true }).reasoning_level).toBe('high');
  });

  it('lets an explicit or agent-saved level beat the unattended default', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.resetModules();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(resolve_model({ nobody_is_waiting: true, reasoning_level: 'low' }).reasoning_level).toBe(
      'low',
    );
    expect(
      resolve_model({ nobody_is_waiting: true, agent_config: { reasoning_level: 'minimal' } })
        .reasoning_level,
    ).toBe('minimal');
  });

  it('keeps a gateway pick on a deployment that can reach nothing else', async () => {
    clear_model_proxy_env();
    const { resolve_model } = await import('@runtime-platform/model_resolver');

    expect(
      resolve_model(
        {
          default_model_proxy: 'vercel_ai_gateway',
          default_model_name: 'anthropic/claude-opus-4.8',
          model_access: locked,
        },
        {
          environment: { VERCEL_AI_GATEWAY_API_KEY: 'vck-deployment' },
          workspace_owned_env_names: new Set(),
        },
      ),
    ).toMatchObject({
      model_proxy: 'vercel_ai_gateway',
      model_name: 'anthropic/claude-opus-4.8',
    });
  });
});

function clear_model_proxy_env() {
  vi.stubEnv('OPENAI_CODEX_ACCESS_TOKEN', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('ANTHROPIC_OAUTH_TOKEN', '');
}
