import {
  default_model_name_for_use_case,
  find_model_proxy_offering_models_made_by,
  list_model_proxies,
  model_name_env_for_use_case,
  normalize_model_route,
  require_model_proxy,
  require_model_use_case_policy,
  resolve_model_profile,
} from '@shared/index';
import { language_model_use_cases } from '@shared/model_configuration_schema';
import {
  format_model_prompt_profile,
  select_model_prompt_profile,
} from '@shared/model_prompt_configuration';
import { describe, expect, it } from 'vitest';

const model_env_names_deployments_set = {
  vercel_ai_gateway: {
    agent_run: 'VERCEL_AI_GATEWAY_MODEL',
    session_title: 'VERCEL_AI_GATEWAY_SESSION_TITLE_MODEL',
    session_summary: 'VERCEL_AI_GATEWAY_SESSION_SUMMARY_MODEL',
    classification: 'VERCEL_AI_GATEWAY_CLASSIFICATION_MODEL',
    onboarding_scan: 'VERCEL_AI_GATEWAY_ONBOARDING_SCAN_MODEL',
    slack_discovery: 'VERCEL_AI_GATEWAY_SLACK_DISCOVERY_MODEL',
    slack_workflow_proposal: 'VERCEL_AI_GATEWAY_SLACK_WORKFLOW_PROPOSAL_MODEL',
    evaluation: 'VERCEL_AI_GATEWAY_EVALUATION_MODEL',
  },
  anthropic_direct: {
    agent_run: 'ANTHROPIC_MODEL',
    session_title: 'ANTHROPIC_SESSION_TITLE_MODEL',
    session_summary: 'ANTHROPIC_SESSION_SUMMARY_MODEL',
    classification: 'ANTHROPIC_CLASSIFICATION_MODEL',
    onboarding_scan: 'ANTHROPIC_ONBOARDING_SCAN_MODEL',
    slack_discovery: 'ANTHROPIC_SLACK_DISCOVERY_MODEL',
    slack_workflow_proposal: 'ANTHROPIC_SLACK_WORKFLOW_PROPOSAL_MODEL',
    evaluation: 'ANTHROPIC_EVALUATION_MODEL',
  },
  openai_direct: {
    agent_run: 'OPENAI_MODEL',
    session_title: 'OPENAI_SESSION_TITLE_MODEL',
    session_summary: 'OPENAI_SESSION_SUMMARY_MODEL',
    classification: 'OPENAI_CLASSIFICATION_MODEL',
    onboarding_scan: 'OPENAI_ONBOARDING_SCAN_MODEL',
    slack_discovery: 'OPENAI_SLACK_DISCOVERY_MODEL',
    slack_workflow_proposal: 'OPENAI_SLACK_WORKFLOW_PROPOSAL_MODEL',
    evaluation: 'OPENAI_EVALUATION_MODEL',
  },
} as const;

describe('declarative model configuration', () => {
  it('derives exactly the model env names deployments already set', () => {
    for (const [proxy_name, env_names_by_use_case] of Object.entries(
      model_env_names_deployments_set,
    )) {
      const proxy = require_model_proxy(proxy_name);
      for (const use_case of language_model_use_cases) {
        expect(model_name_env_for_use_case(proxy, use_case)).toBe(env_names_by_use_case[use_case]);
      }
    }
  });

  it('declares every language-model use case with runtime policy and proxy defaults', () => {
    for (const use_case of language_model_use_cases) {
      const policy = require_model_use_case_policy(use_case);
      expect(policy.prompt_cache_retention).toMatch(/^(none|short|long)$/u);
      expect(policy.maximum_retry_attempts).toBeGreaterThanOrEqual(0);
      for (const proxy_name of policy.try_proxies_in_order) {
        const proxy = list_model_proxies().find((item) => item.model_proxy === proxy_name);
        expect(proxy && default_model_name_for_use_case(proxy, use_case)).toBeTruthy();
      }
    }
  });

  it('resolves customer and browser profiles with explicit provider, proxy, model, and reasoning', () => {
    expect(resolve_model_profile('customer_agent', {})).toEqual({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-6-luna',
      reasoning_level: 'high',
    });
    expect(
      resolve_model_profile('browser_agent', {
        COWORKER_BROWSER_MODEL_PROXY: 'vercel_ai_gateway',
        COWORKER_BROWSER_MODEL_NAME: 'anthropic/claude-opus-4.8',
      }),
    ).toEqual({
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'anthropic/claude-opus-4.8',
      reasoning_level: 'high',
    });
  });

  it('falls back to a credentialed proxy when the profile names one this deployment cannot call', () => {
    expect(resolve_model_profile('customer_agent', { OPENAI_API_KEY: 'openai-key' })).toEqual({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-6-luna',
      reasoning_level: 'high',
    });
    expect(
      resolve_model_profile('customer_agent', { VERCEL_AI_GATEWAY_API_KEY: 'gateway-key' }),
    ).toEqual({
      model_provider: 'zai',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'zai/glm-4.6',
      reasoning_level: 'high',
    });
  });

  it('keeps the profile proxy when its own credential is present', () => {
    expect(
      resolve_model_profile('customer_agent', {
        OPENAI_API_KEY: 'openai-key',
        ANTHROPIC_API_KEY: 'anthropic-key',
      }),
    ).toEqual({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-6-luna',
      reasoning_level: 'high',
    });
  });

  it('normalizes canonical model routes through one registry rule', () => {
    expect(
      normalize_model_route({
        model_provider: 'anthropic',
        model_proxy: 'anthropic',
        model_name: 'claude-sonnet-5',
      }),
    ).toEqual({
      success: true,
      route: {
        model_provider: 'anthropic',
        model_proxy: 'anthropic_direct',
        model_name: 'claude-sonnet-5',
      },
    });
  });

  it('routes each model provider through exactly one proxy, and unnamed ones through the gateway', () => {
    expect(find_model_proxy_offering_models_made_by('anthropic')?.model_proxy).toBe(
      'anthropic_direct',
    );
    expect(find_model_proxy_offering_models_made_by('openai')?.model_proxy).toBe('openai_direct');
    expect(find_model_proxy_offering_models_made_by('zai')?.model_proxy).toBe('vercel_ai_gateway');

    const providers_claimed_more_than_once = list_model_proxies()
      .flatMap((proxy) => proxy.offer_models_made_by ?? [])
      .filter((provider, index, providers) => providers.indexOf(provider) !== index);
    expect(providers_claimed_more_than_once).toEqual([]);
  });

  it('falls back to the gateway for a model provider whose direct proxy is not configured', () => {
    const gateway_only = [require_model_proxy('vercel_ai_gateway')];

    expect(find_model_proxy_offering_models_made_by('anthropic', gateway_only)?.model_proxy).toBe(
      'vercel_ai_gateway',
    );
    expect(find_model_proxy_offering_models_made_by('openai', gateway_only)?.model_proxy).toBe(
      'vercel_ai_gateway',
    );
  });

  it('accepts the pre-rename gateway vocabulary from an already-deployed client', () => {
    expect(
      normalize_model_route({
        model_provider: 'ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      }),
    ).toEqual({
      success: true,
      route: {
        model_provider: 'anthropic',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      },
    });

    expect(
      normalize_model_route({
        model_proxy: 'ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      }),
    ).toMatchObject({
      success: true,
      route: { model_proxy: 'vercel_ai_gateway' },
    });
  });

  it('rejects incomplete, unknown, and incoherent model routes', () => {
    expect(normalize_model_route({ model_provider: 'openai' })).toMatchObject({
      success: false,
      issues: [{ field: 'model_name' }],
    });
    expect(
      normalize_model_route({
        model_provider: 'openai',
        model_proxy: 'unknown_proxy',
        model_name: 'gpt-5.5',
      }),
    ).toMatchObject({
      success: false,
      issues: [{ field: 'model_proxy' }],
    });
    expect(
      normalize_model_route({
        model_provider: 'anthropic',
        model_proxy: 'openai_direct',
        model_name: 'gpt-5.5',
      }),
    ).toMatchObject({
      success: false,
      issues: [{ field: 'model_provider' }],
    });
  });

  it('selects prompt profiles from explicit provider-family rules', () => {
    const anthropic_prompt = format_model_prompt_profile(
      select_model_prompt_profile({
        model_provider: 'anthropic',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      }),
    );
    const openai_prompt = format_model_prompt_profile(
      select_model_prompt_profile({
        model_provider: 'openai',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'openai/gpt-5.5',
      }),
    );
    expect(anthropic_prompt).toContain('Before ending your turn');
    expect(openai_prompt).toContain('Match message length');
  });
});
