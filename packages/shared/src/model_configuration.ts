import model_profiles_data from '@coworker/shared/model_profiles.json' with { type: 'json' };
import model_proxies_data from '@coworker/shared/model_proxies.json' with { type: 'json' };
import model_use_cases_data from '@coworker/shared/model_use_cases.json' with { type: 'json' };
import {
  type LanguageModelUseCase,
  type ModelCatalogSourceName,
  type ModelProfile,
  type ModelProfileName,
  type ModelProxy,
  type ModelSelection,
  model_profiles_file_schema,
  model_proxies_file_schema,
  model_use_cases_file_schema,
} from '@shared/model_configuration_schema';
import {
  agent_run_model_name_of_a_fallback_proxy,
  claims_model_ids_shaped_like,
  find_credential_of_model_proxy,
  is_model_provider_offered_by_proxy,
  read_environment_value,
  read_model_provider,
} from '@shared/model_proxy_record';
import { validate_model_registry } from '@shared/model_registry_rules';
import { parse_json_config } from '@shared/parse_json_config';

export type ModelProxyEnvironment = Record<string, unknown>;

const model_proxies_file = parse_json_config(
  'model_proxies.json',
  model_proxies_file_schema,
  model_proxies_data,
);
const model_use_cases_file = parse_json_config(
  'model_use_cases.json',
  model_use_cases_file_schema,
  model_use_cases_data,
);
const model_profiles_file = parse_json_config(
  'model_profiles.json',
  model_profiles_file_schema,
  model_profiles_data,
);
const model_proxies = model_proxies_file.model_proxies;
const model_use_case_policies = model_use_cases_file.model_use_cases;
const model_proxies_by_every_known_name = index_proxies_by_every_known_name(model_proxies);
validate_model_registry({
  model_proxies,
  model_use_case_policies,
  model_profiles: model_profiles_file.model_profiles,
});

export function list_model_proxies(): ModelProxy[] {
  return model_proxies;
}

export function list_model_proxy_names(): string[] {
  return model_proxies.map((proxy) => proxy.model_proxy);
}

export function require_model_catalog_source(source: ModelCatalogSourceName) {
  return model_proxies_file.model_catalog_sources[source];
}

export function find_model_proxy(proxy_name: string): ModelProxy | undefined {
  return model_proxies_by_every_known_name.get(simplify_proxy_name(proxy_name));
}

export function require_model_proxy(proxy_name: string): ModelProxy {
  const proxy = find_model_proxy(proxy_name);
  if (proxy) return proxy;

  throw new Error(
    `Unknown model proxy: ${proxy_name}. Configured proxies: ${list_model_proxy_names().join(', ')}.`,
  );
}

export function require_model_use_case_policy(use_case: LanguageModelUseCase) {
  const policy = model_use_case_policies[use_case];
  if (policy) return policy;

  throw new Error(`No model use case policy configured for ${use_case}`);
}

export function list_model_proxies_for_use_case(use_case: LanguageModelUseCase): ModelProxy[] {
  return require_model_use_case_policy(use_case).try_proxies_in_order.map(require_model_proxy);
}

export const workspace_model_access_levels = ['all', 'openai_only'] as const;

export type WorkspaceModelAccess = (typeof workspace_model_access_levels)[number];

export type ModelAccessRules = {
  model_access: WorkspaceModelAccess;
  gateway_models_enabled: boolean;
};

export const unrestricted_model_access: ModelAccessRules = {
  model_access: 'all',
  gateway_models_enabled: true,
};

export type ModelProxyLock = 'gateway_not_funded' | 'locked_until_subscribed';

export function find_model_proxy_lock(
  proxy_name: string,
  rules: ModelAccessRules,
): ModelProxyLock | null {
  const proxy = find_model_proxy(proxy_name);
  if (!proxy || proxy.model_provider === undefined) {
    return rules.gateway_models_enabled ? null : 'gateway_not_funded';
  }
  if (rules.model_access === 'all' || proxy.model_provider === 'openai') return null;

  return 'locked_until_subscribed';
}

export function is_model_proxy_within_access(proxy_name: string, rules: ModelAccessRules) {
  return find_model_proxy_lock(proxy_name, rules) === null;
}

export function list_model_proxies_for_use_case_and_access(
  use_case: LanguageModelUseCase,
  rules: ModelAccessRules = unrestricted_model_access,
  environment?: ModelProxyEnvironment,
): ModelProxy[] {
  const proxies = list_model_proxies_for_use_case(use_case);
  if (use_case !== 'agent_run') return proxies;
  const allowed = proxies.filter((proxy) => is_model_proxy_within_access(proxy.model_proxy, rules));
  if (!environment) return allowed;

  return allowed.some((proxy) => find_model_proxy_credential(proxy.model_proxy, environment))
    ? allowed
    : proxies;
}

export function find_model_proxy_for_model_id(
  model_id: string,
  proxies: ModelProxy[] = model_proxies,
): ModelProxy | undefined {
  const candidates = proxies.filter((proxy) => claims_model_ids_shaped_like(proxy, model_id));

  return (
    candidates.find((proxy) =>
      (proxy.claim_model_ids_starting_with ?? []).some((prefix) => model_id.startsWith(prefix)),
    ) ??
    candidates.find((proxy) => proxy.claim_model_ids_no_other_proxy_claims) ??
    candidates[0]
  );
}

export function find_model_proxy_offering_models_made_by(
  model_provider: string,
  proxies: ModelProxy[] = model_proxies,
): ModelProxy | undefined {
  return (
    proxies.find((proxy) => is_model_provider_offered_by_proxy(proxy, model_provider)) ??
    proxies.find((proxy) => proxy.offer_models_no_other_proxy_offers)
  );
}

function require_model_profile(profile_name: ModelProfileName): ModelProfile {
  return model_profiles_file.model_profiles[profile_name];
}

export function resolve_model_profile(
  profile_name: ModelProfileName,
  environment: ModelProxyEnvironment,
): ModelSelection {
  const profile = require_model_profile(profile_name);
  const preferred_proxy_name =
    read_environment_value(environment, profile.read_model_proxy_from_env) ??
    profile.model_proxy_when_env_is_unset;
  const proxy = find_profile_proxy_holding_a_credential(preferred_proxy_name, environment);
  const kept_the_preferred_proxy =
    proxy.model_proxy === require_model_proxy(preferred_proxy_name).model_proxy;
  const model_name = kept_the_preferred_proxy
    ? (read_environment_value(environment, profile.read_model_name_from_env) ??
      profile.model_name_when_env_is_unset)
    : agent_run_model_name_of_a_fallback_proxy(proxy, environment);

  return {
    model_provider: read_model_provider(proxy, model_name),
    model_proxy: proxy.model_proxy,
    model_name,
    reasoning_level: profile.reasoning_level,
  };
}

function find_profile_proxy_holding_a_credential(
  preferred_proxy_name: string,
  environment: ModelProxyEnvironment,
): ModelProxy {
  const preferred_proxy = require_model_proxy(preferred_proxy_name);
  if (find_model_proxy_credential(preferred_proxy.model_proxy, environment)) return preferred_proxy;

  return (
    list_model_proxies_for_use_case('agent_run').find((candidate) =>
      find_model_proxy_credential(candidate.model_proxy, environment),
    ) ?? preferred_proxy
  );
}

export function model_proxy_credential_env_names(proxy_name: string): string[] {
  return require_model_proxy(proxy_name).authenticate_with_first_env_name_present;
}

export function find_model_proxy_credential(
  proxy_name: string,
  environment: ModelProxyEnvironment,
) {
  return find_credential_of_model_proxy(require_model_proxy(proxy_name), environment);
}

function simplify_proxy_name(proxy_name: string): string {
  return proxy_name.trim().toLowerCase().replace(/-/gu, '_');
}

function index_proxies_by_every_known_name(proxies: ModelProxy[]) {
  const proxies_by_name = new Map<string, ModelProxy>();

  for (const proxy of proxies) {
    for (const name of [proxy.model_proxy, ...(proxy.also_known_as ?? [])]) {
      const key = simplify_proxy_name(name);
      const claimed_by = proxies_by_name.get(key);
      if (claimed_by && claimed_by !== proxy) {
        throw new Error(
          `Model proxy name ${name} is claimed by both ${claimed_by.model_proxy} and ${proxy.model_proxy}`,
        );
      }
      proxies_by_name.set(key, proxy);
    }
  }

  return proxies_by_name;
}
