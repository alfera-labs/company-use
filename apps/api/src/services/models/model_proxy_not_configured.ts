import {
  find_model_proxy_definition,
  list_model_proxy_definitions,
} from '@coworker/runtime-platform';
import { AppError, env_names_that_configure_model_proxy } from '@coworker/shared';

export function model_proxy_not_configured(requested_model_proxy?: string) {
  const all_proxies = list_model_proxy_definitions();
  const requested_proxy = requested_model_proxy
    ? find_model_proxy_definition(requested_model_proxy)
    : undefined;
  const credential_env_names = all_proxies.flatMap(env_names_that_configure_model_proxy);
  const requested_credential_env_names = requested_proxy
    ? env_names_that_configure_model_proxy(requested_proxy)
    : credential_env_names;

  return new AppError(
    'model_proxy_not_configured',
    requested_proxy
      ? `Model proxy ${requested_proxy.model_proxy} is not configured. Set ${requested_credential_env_names.join(' or ')}.`
      : `No model proxy is configured. Set one of: ${credential_env_names.join(', ')}.`,
    503,
    {
      ...(requested_proxy
        ? { model_proxy: requested_proxy.model_proxy }
        : { model_proxies: all_proxies.map((proxy) => proxy.model_proxy) }),
      credential_env_names: requested_credential_env_names,
    },
  );
}
