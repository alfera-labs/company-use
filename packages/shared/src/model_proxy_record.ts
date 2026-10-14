import {
  type LanguageModelUseCase,
  language_model_use_cases,
  type ModelProxy,
} from '@shared/model_configuration_schema';

export function pi_provider_name_of_proxy(proxy: ModelProxy): string {
  const rewrite = proxy.rewrite_provider_payload_as;
  return rewrite
    ? `${proxy.reach_models_through_pi_provider}:${rewrite}`
    : proxy.reach_models_through_pi_provider;
}

export function model_name_env_for_use_case(
  proxy: ModelProxy,
  use_case: LanguageModelUseCase,
): string {
  if (use_case === 'agent_run') return shared_model_name_env(proxy);
  return `${proxy.read_model_names_from_env_prefixed}_${use_case.toUpperCase()}_MODEL`;
}

export function shared_model_name_env(proxy: ModelProxy): string {
  return `${proxy.read_model_names_from_env_prefixed}_MODEL`;
}

export function default_model_name_for_use_case(
  proxy: ModelProxy,
  use_case: LanguageModelUseCase,
): string {
  return (
    proxy.model_name_when_env_is_unset_by_use_case?.[use_case] ?? proxy.model_name_when_env_is_unset
  );
}

/** The model names the operator wrote in this proxy's env settings, the agent-run one first. */
export function list_model_names_in_env(
  proxy: ModelProxy,
  environment: Record<string, unknown>,
): string[] {
  const env_names = [
    shared_model_name_env(proxy),
    ...language_model_use_cases.map((use_case) => model_name_env_for_use_case(proxy, use_case)),
  ];
  const model_names = env_names.flatMap(
    (env_name) => read_environment_value(environment, env_name) ?? [],
  );
  return [...new Set(model_names)];
}

export function list_model_ids_the_proxy_offers(
  proxy: ModelProxy,
  environment: Record<string, unknown>,
): string[] | undefined {
  const env_name = proxy.offer_only_the_model_ids_listed_in_env;
  if (!env_name) return undefined;
  return (read_environment_value(environment, env_name) ?? '').split(',').filter(Boolean);
}

export function keep_to_the_model_ids_the_proxy_offers(
  proxy: ModelProxy,
  model_name: string,
  environment: Record<string, unknown>,
): string {
  const offered = list_model_ids_the_proxy_offers(proxy, environment);
  if (!offered || offered.length === 0 || offered.includes(model_name)) return model_name;
  const default_model = proxy.model_name_when_env_is_unset;
  return offered.includes(default_model) ? default_model : (offered[0] ?? model_name);
}

/** The env names an operator sets to configure a proxy: its address, or else one of its keys. */
export function env_names_that_configure_model_proxy(proxy: ModelProxy): string[] {
  return proxy.reach_models_at_the_address_in_env
    ? [proxy.reach_models_at_the_address_in_env]
    : proxy.authenticate_with_first_env_name_present;
}

export function read_model_provider(proxy: ModelProxy, model_id: string): string {
  if (proxy.model_ids_are_written_as !== 'provider_slash_model') {
    return require_declared_provider(proxy);
  }

  const provider = model_id.split('/', 1)[0];
  if (provider?.trim()) return read_model_provider_name(proxy, provider);

  throw new Error(`Model ${model_id} from ${proxy.model_proxy} does not name its provider`);
}

/** The models.dev name of a model provider this proxy writes its own way, like `x-ai` for `xai`. */
export function read_model_provider_name(proxy: ModelProxy, written_name: string): string {
  const name = written_name.trim().toLowerCase().replace(/^~/u, '');
  return proxy.models_dev_names_of_model_providers?.[name] ?? name;
}

export function is_model_provider_offered_by_proxy(
  proxy: ModelProxy,
  model_provider: string,
): boolean {
  return (proxy.offer_models_made_by ?? []).includes(model_provider);
}

/** A proxy that takes any model name claims none: an id never routes to it by its shape. */
export function claims_model_ids_shaped_like(proxy: ModelProxy, model_id: string): boolean {
  return (
    proxy.model_ids_are_written_as !== 'any_model_name' &&
    is_model_id_shaped_for_proxy(proxy, model_id)
  );
}

export function is_model_id_shaped_for_proxy(proxy: ModelProxy, model_id: string): boolean {
  if (proxy.model_ids_are_written_as === 'any_model_name') return true;
  const has_provider_namespace = model_id.includes('/');
  return proxy.model_ids_are_written_as === 'provider_slash_model'
    ? has_provider_namespace
    : !has_provider_namespace;
}

const api_key_sent_to_a_server_that_needs_none = 'no-key';

/**
 * The key a proxy is called with, or undefined when it is not configured here. A proxy that is
 * reached at an address is configured by that address, and its key is optional.
 */
export function find_credential_of_model_proxy(
  proxy: ModelProxy,
  environment: Record<string, unknown>,
) {
  if (!is_model_proxy_served_on_this_install(proxy, environment)) return undefined;
  const address_env_name = proxy.reach_models_at_the_address_in_env;
  if (address_env_name && !read_environment_value(environment, address_env_name)) return undefined;

  const env_names = proxy.authenticate_with_first_env_name_present;
  for (const env_name of env_names) {
    const api_key = read_environment_value(environment, env_name);
    if (api_key) return { api_key, env_name };
  }
  const [first_env_name] = env_names;
  if (!address_env_name || !first_env_name) return undefined;

  return { api_key: api_key_sent_to_a_server_that_needs_none, env_name: first_env_name };
}

/** False for a proxy of a self-hosted install, on an install that is not self-hosted. */
export function is_model_proxy_served_on_this_install(
  proxy: ModelProxy,
  environment: Record<string, unknown>,
) {
  const switch_env_name = proxy.serve_only_when_env_is_true;
  return !switch_env_name || ['true', '1'].includes(String(environment[switch_env_name]));
}

export function agent_run_model_name_of_a_fallback_proxy(
  proxy: ModelProxy,
  environment: Record<string, unknown>,
) {
  const model_named_in_env = proxy.run_only_the_models_named_in_env
    ? read_environment_value(environment, shared_model_name_env(proxy))
    : undefined;
  return model_named_in_env ?? default_model_name_for_use_case(proxy, 'agent_run');
}

export function read_environment_value(
  environment: Record<string, unknown>,
  env_name: string | undefined,
) {
  if (!env_name) return undefined;
  const value = environment[env_name];
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function require_declared_provider(proxy: ModelProxy): string {
  if (proxy.model_provider) return proxy.model_provider;

  throw new Error(`Proxy ${proxy.model_proxy} does not declare who provides its models`);
}
