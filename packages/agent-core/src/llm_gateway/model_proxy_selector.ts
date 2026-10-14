import type { LlmModelResolutionInput } from '@agent-core/llm_gateway/gateway_types';
import { MissingEveryModelProxyCredentialError } from '@agent-core/llm_gateway/model_credential_error';
import type { LlmEnvironment } from '@agent-core/llm_gateway/model_resolver';
import {
  env_names_that_configure_model_proxy,
  find_model_proxy,
  find_model_proxy_credential,
  find_model_proxy_for_model_id,
  is_model_proxy_served_on_this_install,
  list_model_proxies_for_use_case_and_access,
  list_model_proxy_names,
  type ModelProxy,
} from '@coworker/shared';

export function choose_model_proxy(
  input: LlmModelResolutionInput,
  environment: LlmEnvironment,
): ModelProxy {
  const allowed_proxies = list_model_proxies_for_use_case_and_access(
    input.use_case,
    input.model_access,
    environment,
  );
  const requested_proxy = input.model_proxy;
  const requested_model = input.model_name;

  if (requested_proxy && requested_proxy !== 'local') {
    return require_proxy_allowed_for_use_case(requested_proxy, input.use_case, allowed_proxies);
  }

  if (requested_model && !is_placeholder_model_name(requested_model)) {
    return require_proxy_claiming_model_id(requested_model, input.use_case, allowed_proxies);
  }

  return require_proxy_holding_a_credential(allowed_proxies, environment);
}

function require_proxy_allowed_for_use_case(
  requested_proxy: string,
  use_case: string,
  allowed_proxies: ModelProxy[],
): ModelProxy {
  const proxy = find_model_proxy(requested_proxy);
  if (!proxy) {
    throw new Error(
      `Unknown model proxy: ${requested_proxy}. Configured proxies: ${list_model_proxy_names().join(', ')}.`,
    );
  }
  if (!allowed_proxies.includes(proxy)) {
    throw new Error(`Model proxy ${proxy.model_proxy} is not allowed for use case ${use_case}`);
  }

  return proxy;
}

function require_proxy_claiming_model_id(
  model_id: string,
  use_case: string,
  allowed_proxies: ModelProxy[],
): ModelProxy {
  const proxy = find_model_proxy_for_model_id(model_id, allowed_proxies);
  if (proxy) return proxy;

  throw new Error(
    `No model proxy for use case ${use_case} accepts model ${model_id}. Proxies for this use case: ${allowed_proxies.map((candidate) => candidate.model_proxy).join(', ')}.`,
  );
}

function require_proxy_holding_a_credential(
  allowed_proxies: ModelProxy[],
  environment: LlmEnvironment,
): ModelProxy {
  for (const proxy of allowed_proxies) {
    if (find_model_proxy_credential(proxy.model_proxy, environment)) return proxy;
  }

  const env_names = allowed_proxies
    .filter((proxy) => is_model_proxy_served_on_this_install(proxy, environment))
    .flatMap(env_names_that_configure_model_proxy);
  throw new MissingEveryModelProxyCredentialError(env_names);
}

export function is_placeholder_model_name(model_name: string) {
  return model_name === 'local' || model_name === 'old-local-model';
}
