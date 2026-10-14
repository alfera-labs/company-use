import type {
  LlmModelResolutionInput,
  LlmResolvedModel,
} from '@agent-core/llm_gateway/gateway_types';
import { MissingModelProxyCredentialError } from '@agent-core/llm_gateway/model_credential_error';
import {
  choose_model_proxy,
  is_placeholder_model_name,
} from '@agent-core/llm_gateway/model_proxy_selector';
import {
  default_model_name_for_use_case,
  find_model_proxy_credential,
  keep_to_the_model_ids_the_proxy_offers,
  list_model_names_in_env,
  type ModelProxy,
  type ModelUseCasePolicy,
  model_name_env_for_use_case,
  read_model_provider,
  require_model_proxy,
  require_model_use_case_policy,
  shared_model_name_env,
} from '@coworker/shared';

export type LlmEnvironment = Record<string, string | undefined>;

export function resolve_llm_model(
  input: LlmModelResolutionInput,
  environment: LlmEnvironment = read_process_env(),
): LlmResolvedModel {
  const policy = require_model_use_case_policy(input.use_case);
  const proxy = choose_model_proxy(input, environment);
  const credential = find_model_proxy_credential(proxy.model_proxy, environment);

  if (!credential) {
    throw new MissingModelProxyCredentialError(proxy.model_proxy);
  }

  const chosen_model_name = find_chosen_model_name(input, proxy, environment);
  const model_name = keep_to_the_model_ids_the_proxy_offers(
    proxy,
    chosen_model_name ?? read_default_model_name(proxy, input.use_case, policy, environment),
    environment,
  );

  return {
    model_proxy: proxy.model_proxy,
    model_provider: read_model_provider(proxy, model_name),
    model_name,
    api_key: credential.api_key,
    credential_env_name: credential.env_name,
    reasoning_level: input.reasoning_level ?? policy.reasoning_level,
    ...max_output_tokens_field(input.max_output_tokens, policy),
    ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
  };
}

export function llm_proxy_credential_env_names(proxy_name: string) {
  return require_model_proxy(proxy_name).authenticate_with_first_env_name_present;
}

function find_chosen_model_name(
  input: LlmModelResolutionInput,
  proxy: ModelProxy,
  environment: LlmEnvironment,
) {
  const requested_model = input.model_name;
  if (!requested_model || is_placeholder_model_name(requested_model)) return null;
  if (!proxy.run_only_the_models_named_in_env) return requested_model;

  return list_model_names_in_env(proxy, environment).includes(requested_model)
    ? requested_model
    : null;
}

function read_default_model_name(
  proxy: ModelProxy,
  use_case: LlmModelResolutionInput['use_case'],
  policy: ModelUseCasePolicy,
  environment: LlmEnvironment,
) {
  const use_case_model = environment[model_name_env_for_use_case(proxy, use_case)]?.trim();
  if (use_case_model) return use_case_model;

  if (
    policy.when_use_case_model_env_is_unset === 'try_the_proxies_shared_model_env' ||
    proxy.run_only_the_models_named_in_env
  ) {
    const shared_model = environment[shared_model_name_env(proxy)]?.trim();
    if (shared_model) return shared_model;
  }

  return default_model_name_for_use_case(proxy, use_case);
}

function max_output_tokens_field(
  requested_max_output_tokens: number | null | undefined,
  policy: ModelUseCasePolicy,
) {
  if (typeof requested_max_output_tokens === 'number') {
    return { max_output_tokens: requested_max_output_tokens };
  }

  return policy.max_output_tokens === undefined
    ? {}
    : { max_output_tokens: policy.max_output_tokens };
}

export function read_process_env(): LlmEnvironment {
  const maybe_process = (globalThis as { process?: { env?: LlmEnvironment } }).process;
  return maybe_process?.env ?? {};
}
