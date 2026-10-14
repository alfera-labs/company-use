import { find_model_proxy_offering_models_made_by } from '@shared/model_configuration';
import type {
  ModelProfile,
  ModelProxy,
  ModelUseCasePolicy,
} from '@shared/model_configuration_schema';
import { type ModelRegistry, validate_model_registry } from '@shared/model_registry_rules';
import { describe, expect, it } from 'vitest';

describe('model registry rules', () => {
  it('accepts a registry where every model provider has one proxy and one catch-all takes the rest', () => {
    expect(() =>
      validate_model_registry(
        registry([
          proxy('anthropic_direct', { offer_models_made_by: ['anthropic'] }),
          proxy('openai_direct', { offer_models_made_by: ['openai'] }),
          proxy('gateway', { offer_models_no_other_proxy_offers: true }),
        ]),
      ),
    ).not.toThrow();
  });

  it('rejects two proxies offering the same model provider', () => {
    expect(() =>
      validate_model_registry(
        registry([
          proxy('anthropic_direct', { offer_models_made_by: ['anthropic'] }),
          proxy('bedrock', { offer_models_made_by: ['anthropic'] }),
        ]),
      ),
    ).toThrow('Models made by anthropic are offered by both anthropic_direct and bedrock');
  });

  it('accepts two gateways offering the models no other proxy offers, the first configured wins', () => {
    const proxies = [
      proxy('gateway', { offer_models_no_other_proxy_offers: true }),
      proxy('other_gateway', { offer_models_no_other_proxy_offers: true }),
    ];

    expect(() => validate_model_registry(registry(proxies))).not.toThrow();
    expect(find_model_proxy_offering_models_made_by('zai', proxies)?.model_proxy).toBe('gateway');
    expect(find_model_proxy_offering_models_made_by('zai', proxies.slice(1))?.model_proxy).toBe(
      'other_gateway',
    );
  });

  it('rejects two proxies claiming the model ids nobody else claimed', () => {
    expect(() =>
      validate_model_registry(
        registry([
          proxy('openai_direct', { claim_model_ids_no_other_proxy_claims: true }),
          proxy('gateway', { claim_model_ids_no_other_proxy_claims: true }),
        ]),
      ),
    ).toThrow('Only one model proxy may claim unmatched model ids');
  });

  it('rejects a use case naming a proxy that does not exist', () => {
    const invalid = registry([proxy('gateway')]);
    invalid.model_use_case_policies = { agent_run: use_case_policy('retired_proxy') };

    expect(() => validate_model_registry(invalid)).toThrow(
      'Use case agent_run lists unknown model proxy retired_proxy',
    );
  });

  it('rejects a profile naming a proxy that does not exist', () => {
    const invalid = registry([proxy('gateway')]);
    invalid.model_profiles = { customer_agent: model_profile('retired_proxy') };

    expect(() => validate_model_registry(invalid)).toThrow(
      'Model profile lists unknown model proxy retired_proxy',
    );
  });
});

function registry(model_proxies: ModelProxy[]): ModelRegistry {
  return { model_proxies, model_use_case_policies: {}, model_profiles: {} };
}

function use_case_policy(...try_proxies_in_order: string[]): ModelUseCasePolicy {
  return {
    try_proxies_in_order,
    when_use_case_model_env_is_unset: 'use_the_default_model_name',
    stream: true,
    tools: true,
    images: false,
    reasoning_level: 'off',
    prompt_cache_retention: 'none',
    maximum_retry_attempts: 0,
  };
}

function model_profile(model_proxy_when_env_is_unset: string): ModelProfile {
  return {
    model_proxy_when_env_is_unset,
    model_name_when_env_is_unset: 'some/model',
    reasoning_level: 'off',
  };
}

function proxy(model_proxy: string, claims: Partial<ModelProxy> = {}): ModelProxy {
  return {
    model_proxy,
    display_name: model_proxy,
    reach_models_through_pi_provider: model_proxy,
    authenticate_with_first_env_name_present: ['API_KEY'],
    model_ids_are_written_as: 'provider_slash_model',
    models_dev_provider_name: model_proxy,
    read_model_names_from_env_prefixed: 'PROXY',
    model_name_when_env_is_unset: 'some/model',
    ...claims,
  };
}
