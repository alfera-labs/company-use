import { llm_proxy_credential_env_names, resolve_llm_model } from '@agent-core/llm_gateway';
import {
  list_model_proxies_for_use_case,
  list_model_proxies_for_use_case_and_access,
  unrestricted_model_access,
} from '@coworker/shared';
import { describe, expect, it } from 'vitest';

describe('resolve_llm_model', () => {
  it('uses OpenAI for agent runs when it is the only configured proxy', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_proxy: 'local', model_name: 'local' },
        { OPENAI_API_KEY: 'openai-key' },
      ),
    ).toMatchObject({
      model_proxy: 'openai_direct',
      model_provider: 'openai',
      model_name: 'gpt-5.6-luna',
      api_key: 'openai-key',
      credential_env_name: 'OPENAI_API_KEY',
      reasoning_level: 'medium',
    });
  });

  it('uses OpenAI first for agent runs when multiple proxy keys exist', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_proxy: 'local', model_name: 'local' },
        { OPENAI_API_KEY: 'openai-key', ANTHROPIC_API_KEY: 'anthropic-key' },
      ),
    ).toMatchObject({
      model_proxy: 'openai_direct',
      model_provider: 'openai',
      model_name: 'gpt-5.6-luna',
      api_key: 'openai-key',
      credential_env_name: 'OPENAI_API_KEY',
      reasoning_level: 'medium',
    });
  });

  it('preserves requested Anthropic model ids before runtime execution', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_proxy: 'anthropic', model_name: 'claude-fable-5' },
        { ANTHROPIC_API_KEY: 'anthropic-key' },
      ),
    ).toMatchObject({
      model_proxy: 'anthropic_direct',
      model_provider: 'anthropic',
      model_name: 'claude-fable-5',
      api_key: 'anthropic-key',
    });
  });

  it('uses the title model policy for session titles', () => {
    expect(
      resolve_llm_model(
        { use_case: 'session_title' },
        { OPENAI_API_KEY: 'openai-key', OPENAI_SESSION_TITLE_MODEL: 'gpt-5.4-nano' },
      ),
    ).toMatchObject({
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.4-nano',
      reasoning_level: 'off',
      max_output_tokens: 64,
    });
  });

  it('uses a cheap fallback model for session titles', () => {
    expect(
      resolve_llm_model({ use_case: 'session_title' }, { OPENAI_API_KEY: 'openai-key' }),
    ).toMatchObject({
      model_proxy: 'openai_direct',
      model_name: 'gpt-4.1-nano',
      reasoning_level: 'off',
      max_output_tokens: 64,
    });
  });

  it('keeps classifications on their fast model instead of the shared agent model', () => {
    expect(
      resolve_llm_model(
        { use_case: 'classification' },
        { OPENAI_API_KEY: 'openai-key', OPENAI_MODEL: 'gpt-5.5' },
      ),
    ).toMatchObject({
      model_proxy: 'openai_direct',
      model_name: 'gpt-4.1-mini',
      reasoning_level: 'off',
    });
  });

  it('falls back to the default Vercel GLM model when only the gateway is configured', () => {
    expect(
      resolve_llm_model({ use_case: 'agent_run' }, { VERCEL_AI_GATEWAY_API_KEY: 'gateway-key' }),
    ).toMatchObject({
      model_proxy: 'vercel_ai_gateway',
      model_provider: 'zai',
      model_name: 'zai/glm-4.6',
      api_key: 'gateway-key',
    });
  });

  it('uses configured gateway models over the fallback model', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run' },
        {
          VERCEL_AI_GATEWAY_API_KEY: 'gateway-key',
          VERCEL_AI_GATEWAY_MODEL: 'openai/gpt-5.4-mini',
        },
      ),
    ).toMatchObject({
      model_proxy: 'vercel_ai_gateway',
      model_provider: 'openai',
      model_name: 'openai/gpt-5.4-mini',
      api_key: 'gateway-key',
    });
  });

  it('routes a namespaced model id to the proxy that accepts that shape', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_name: 'anthropic/claude-sonnet-5' },
        { OPENAI_API_KEY: 'openai-key', VERCEL_AI_GATEWAY_API_KEY: 'gateway-key' },
      ),
    ).toMatchObject({
      model_proxy: 'vercel_ai_gateway',
      model_provider: 'anthropic',
      model_name: 'anthropic/claude-sonnet-5',
      api_key: 'gateway-key',
    });
  });

  it('preserves configured Anthropic models routed through the gateway', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_name: 'anthropic/claude-sonnet-5' },
        { VERCEL_AI_GATEWAY_API_KEY: 'gateway-key' },
      ),
    ).toMatchObject({
      model_proxy: 'vercel_ai_gateway',
      model_provider: 'anthropic',
      model_name: 'anthropic/claude-sonnet-5',
      api_key: 'gateway-key',
    });
  });

  it('sends a bare Claude model id to Anthropic rather than the catch-all proxy', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_name: 'claude-sonnet-4-5' },
        { OPENAI_API_KEY: 'openai-key', ANTHROPIC_API_KEY: 'anthropic-key' },
      ),
    ).toMatchObject({
      model_proxy: 'anthropic_direct',
      model_provider: 'anthropic',
      model_name: 'claude-sonnet-4-5',
      api_key: 'anthropic-key',
    });
  });

  it('rejects a configured proxy without credentials', () => {
    expect(() =>
      resolve_llm_model(
        { use_case: 'agent_run', model_proxy: 'openai', model_name: 'gpt-5.5' },
        {},
      ),
    ).toThrow('No API key configured for model proxy: openai_direct');
  });

  it('lists credential env names for proxy aliases', () => {
    expect(llm_proxy_credential_env_names('vercel-ai-gateway')).toEqual([
      'VERCEL_AI_GATEWAY_API_KEY',
    ]);
    expect(llm_proxy_credential_env_names('vercel_ai_gateway')).toEqual([
      'VERCEL_AI_GATEWAY_API_KEY',
    ]);
  });

  it('prefers OpenAI for evaluation when multiple judge proxies are configured', () => {
    expect(
      resolve_llm_model(
        { use_case: 'evaluation' },
        { OPENAI_API_KEY: 'openai-key', ANTHROPIC_API_KEY: 'anthropic-key' },
      ),
    ).toMatchObject({
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.5',
      reasoning_level: 'low',
    });
  });
});

describe('the proxy order under model access rules', () => {
  const locked = { model_access: 'openai_only', gateway_models_enabled: false } as const;
  const converted = { model_access: 'all', gateway_models_enabled: false } as const;
  const every_key = {
    ANTHROPIC_API_KEY: 'anthropic-key',
    VERCEL_AI_GATEWAY_API_KEY: 'gateway-key',
  };

  it('filters the agent-run order down to OpenAI for a locked workspace', () => {
    expect(list_model_proxies_for_use_case_and_access('agent_run', locked).map(proxy_name)).toEqual(
      ['openai_codex', 'chatgpt_plan', 'openai_direct'],
    );
  });

  it('adds Anthropic back once the subscription converts, and still not the gateway', () => {
    expect(
      list_model_proxies_for_use_case_and_access('agent_run', converted).map(proxy_name),
    ).toEqual([
      'openai_codex',
      'openai_compatible',
      'chatgpt_plan',
      'openai_direct',
      'anthropic_direct',
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
    ]);
  });

  it('leaves the agent-run order whole when everything is unlocked', () => {
    expect(
      list_model_proxies_for_use_case_and_access('agent_run', unrestricted_model_access).map(
        proxy_name,
      ),
    ).toEqual(list_model_proxies_for_use_case('agent_run').map(proxy_name));
  });

  it('leaves the onboarding scan order untouched under every rule', () => {
    const untouched = list_model_proxies_for_use_case('onboarding_scan').map(proxy_name);

    for (const rules of [locked, converted, unrestricted_model_access]) {
      expect(
        list_model_proxies_for_use_case_and_access('onboarding_scan', rules).map(proxy_name),
      ).toEqual(untouched);
    }
    expect(untouched.slice(0, 2)).toEqual(['openai_compatible', 'anthropic_direct']);
  });

  it('still resolves the onboarding scan onto its first model for a locked workspace', () => {
    expect(
      resolve_llm_model({ use_case: 'onboarding_scan', model_access: locked }, every_key),
    ).toMatchObject({ model_proxy: 'anthropic_direct', model_name: 'claude-opus-5-5' });
  });

  it('falls back to the gateway for the onboarding scan when Anthropic has no key', () => {
    expect(
      resolve_llm_model(
        { use_case: 'onboarding_scan', model_access: locked },
        { VERCEL_AI_GATEWAY_API_KEY: 'gateway-key' },
      ),
    ).toMatchObject({ model_proxy: 'vercel_ai_gateway', model_name: 'zai/glm-5.2-fast' });
  });

  it('keeps the whole order when the rules would leave nothing this deployment can call', () => {
    expect(
      resolve_llm_model({ use_case: 'agent_run', model_access: locked }, every_key),
    ).toMatchObject({ model_proxy: 'anthropic_direct' });
  });

  it('narrows the order as soon as an allowed proxy holds a credential', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_access: locked },
        { ...every_key, OPENAI_API_KEY: 'openai-key' },
      ),
    ).toMatchObject({ model_proxy: 'openai_direct' });
  });
});

function proxy_name(proxy: { model_proxy: string }) {
  return proxy.model_proxy;
}
