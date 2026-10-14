import type { LlmUseCase } from '@agent-core/llm_gateway/gateway_types';
import {
  default_model_name_for_use_case,
  find_model_proxy,
  find_model_proxy_credential,
  is_model_id_shaped_for_proxy,
  list_model_proxies_for_use_case,
  list_model_proxy_names,
  model_proxy_credential_env_names,
  read_model_provider,
  require_model_catalog_source,
  require_model_proxy,
  require_model_use_case_policy,
} from '@coworker/shared';
import { describe, expect, it } from 'vitest';

const credential_env_names_before_the_registry = {
  openai_direct: ['OPENAI_API_KEY'],
  openai_codex: ['OPENAI_CODEX_ACCESS_TOKEN'],
  vercel_ai_gateway: ['VERCEL_AI_GATEWAY_API_KEY'],
  anthropic_direct: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'],
};

const proxy_order_before_the_registry: Record<LlmUseCase, string[]> = {
  agent_run: ['openai_codex', 'openai_direct', 'anthropic_direct', 'vercel_ai_gateway'],
  session_title: ['openai_direct', 'vercel_ai_gateway', 'anthropic_direct'],
  session_summary: ['openai_direct', 'vercel_ai_gateway', 'anthropic_direct'],
  classification: ['openai_direct', 'vercel_ai_gateway', 'anthropic_direct'],
  onboarding_scan: ['anthropic_direct', 'vercel_ai_gateway', 'openai_direct'],
  slack_discovery: ['vercel_ai_gateway', 'openai_direct', 'anthropic_direct'],
  slack_workflow_proposal: ['openai_direct', 'vercel_ai_gateway', 'anthropic_direct'],
  evaluation: ['openai_direct', 'vercel_ai_gateway', 'anthropic_direct'],
};

const model_name_when_env_is_unset_before_the_registry: Record<
  LlmUseCase,
  Record<string, string>
> = {
  agent_run: {
    anthropic_direct: 'claude-sonnet-5',
    vercel_ai_gateway: 'zai/glm-4.6',
    openai_direct: 'gpt-5.6-luna',
  },
  session_title: {
    openai_direct: 'gpt-4.1-nano',
    vercel_ai_gateway: 'openai/gpt-4.1-nano',
    anthropic_direct: 'claude-sonnet-5',
  },
  session_summary: {
    openai_direct: 'gpt-5.6-luna',
    vercel_ai_gateway: 'openai/gpt-5.4-mini',
    anthropic_direct: 'claude-sonnet-5',
  },
  classification: {
    openai_direct: 'gpt-4.1-mini',
    vercel_ai_gateway: 'openai/gpt-4.1-mini',
    anthropic_direct: 'claude-sonnet-5',
  },
  onboarding_scan: {
    openai_direct: 'gpt-5.6-luna',
    vercel_ai_gateway: 'zai/glm-5.2-fast',
    anthropic_direct: 'claude-opus-5-5',
  },
  slack_discovery: {
    openai_direct: 'gpt-5.6-luna',
    vercel_ai_gateway: 'zai/glm-5.2-fast',
    anthropic_direct: 'claude-sonnet-5',
  },
  slack_workflow_proposal: {
    openai_direct: 'gpt-5.6-luna',
    vercel_ai_gateway: 'zai/glm-5.2-fast',
    anthropic_direct: 'claude-sonnet-5',
  },
  evaluation: {
    openai_direct: 'gpt-5.5',
    vercel_ai_gateway: 'openai/gpt-5.5',
    anthropic_direct: 'claude-sonnet-5',
  },
};

describe('model proxy registry', () => {
  it('loads and validates every proxy in the data file', () => {
    expect(list_model_proxy_names()).toEqual([
      'vercel_ai_gateway',
      'anthropic_direct',
      'openai_codex',
      'openai_compatible',
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
      'chatgpt_plan',
    ]);
  });

  it('loads catalog refresh behavior from the same validated data file', () => {
    expect(require_model_catalog_source('models_dev')).toEqual({
      fetch_from: 'https://models.dev/api.json',
      refresh_after_ms: 86_400_000,
      retry_after_failure_ms: 300_000,
      request_timeout_ms: 10_000,
    });
  });

  it('resolves canonical proxy names and direct-provider aliases', () => {
    expect(require_model_proxy('vercel_ai_gateway').model_proxy).toBe('vercel_ai_gateway');
    expect(require_model_proxy('anthropic').model_proxy).toBe('anthropic_direct');
    expect(require_model_proxy('openai').model_proxy).toBe('openai_direct');
  });

  it('reports an unknown proxy by name instead of guessing one', () => {
    expect(find_model_proxy('cohere_direct')).toBeUndefined();
    expect(() => require_model_proxy('cohere_direct')).toThrow(
      /Unknown model proxy: cohere_direct/u,
    );
  });

  it('keeps the credential env names that shipped before the registry', () => {
    for (const [proxy_name, env_names] of Object.entries(
      credential_env_names_before_the_registry,
    )) {
      expect(model_proxy_credential_env_names(proxy_name)).toEqual(env_names);
    }
  });

  it('keeps the proxy order every use case shipped with', () => {
    for (const [use_case, proxy_names] of Object.entries(proxy_order_before_the_registry)) {
      const proxies = list_model_proxies_for_use_case(use_case as LlmUseCase);
      expect(
        proxies.map((proxy) => proxy.model_proxy).filter((name) => proxy_names.includes(name)),
      ).toEqual(proxy_names);
    }
  });

  it('tries the model address of a self-hosted install before every proxy that holds a key', () => {
    for (const use_case of Object.keys(proxy_order_before_the_registry)) {
      const proxy_names = list_model_proxies_for_use_case(use_case as LlmUseCase).map(
        (proxy) => proxy.model_proxy,
      );
      expect(proxy_names.filter((name) => name !== 'openai_codex')[0]).toBe('openai_compatible');
    }
  });

  it('keeps the default model each proxy serves for each use case', () => {
    for (const [use_case, models_by_proxy] of Object.entries(
      model_name_when_env_is_unset_before_the_registry,
    )) {
      for (const [proxy_name, model_name] of Object.entries(models_by_proxy)) {
        const proxy = require_model_proxy(proxy_name);
        expect(default_model_name_for_use_case(proxy, use_case as LlmUseCase)).toBe(model_name);
      }
    }
  });

  it('takes the first credential present in the order the proxy lists', () => {
    expect(
      find_model_proxy_credential('anthropic_direct', {
        ANTHROPIC_OAUTH_TOKEN: 'oauth-token',
      }),
    ).toEqual({ api_key: 'oauth-token', env_name: 'ANTHROPIC_OAUTH_TOKEN' });

    expect(
      find_model_proxy_credential('anthropic_direct', {
        ANTHROPIC_API_KEY: 'api-key',
        ANTHROPIC_OAUTH_TOKEN: 'oauth-token',
      }),
    ).toEqual({ api_key: 'api-key', env_name: 'ANTHROPIC_API_KEY' });

    expect(
      find_model_proxy_credential('anthropic_direct', { OPENAI_API_KEY: 'x' }),
    ).toBeUndefined();
  });

  it('ignores a credential that is present but blank', () => {
    expect(
      find_model_proxy_credential('vercel_ai_gateway', { VERCEL_AI_GATEWAY_API_KEY: '   ' }),
    ).toBeUndefined();
  });

  it('reads the model provider from the id namespace or the proxy that declares it', () => {
    const gateway = require_model_proxy('vercel_ai_gateway');
    const anthropic = require_model_proxy('anthropic_direct');

    expect(read_model_provider(gateway, 'anthropic/claude-opus-4.8')).toBe('anthropic');
    expect(read_model_provider(gateway, 'zai/glm-4.6')).toBe('zai');
    expect(
      read_model_provider(require_model_proxy('openrouter'), '~anthropic/claude-sonnet-latest'),
    ).toBe('anthropic');
    expect(read_model_provider(anthropic, 'claude-opus-4.8')).toBe('anthropic');
  });

  it('recognizes which model ids each proxy accepts', () => {
    const gateway = require_model_proxy('vercel_ai_gateway');
    const anthropic = require_model_proxy('anthropic_direct');

    expect(is_model_id_shaped_for_proxy(gateway, 'anthropic/claude-opus-4.8')).toBe(true);
    expect(is_model_id_shaped_for_proxy(gateway, 'claude-opus-4.8')).toBe(false);
    expect(is_model_id_shaped_for_proxy(anthropic, 'claude-opus-4.8')).toBe(true);
    expect(is_model_id_shaped_for_proxy(anthropic, 'anthropic/claude-opus-4.8')).toBe(false);
  });

  it('keeps the per-use-case request shape that shipped before the registry', () => {
    expect(require_model_use_case_policy('agent_run')).toMatchObject({
      stream: true,
      tools: true,
      images: true,
      reasoning_level: 'medium',
      reasoning_level_when_nobody_is_waiting: 'high',
    });
    expect(require_model_use_case_policy('session_title')).toMatchObject({
      stream: false,
      reasoning_level: 'off',
      max_output_tokens: 64,
    });
    expect(require_model_use_case_policy('classification')).toMatchObject({
      when_use_case_model_env_is_unset: 'use_the_default_model_name',
      max_output_tokens: 512,
    });
    expect(require_model_use_case_policy('session_summary')).toMatchObject({
      when_use_case_model_env_is_unset: 'use_the_default_model_name',
      reasoning_level: 'low',
      max_output_tokens: 1200,
    });
  });
});
