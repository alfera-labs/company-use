import {
  MissingEveryModelProxyCredentialError,
  MissingModelProxyCredentialError,
} from '@agent-core/llm_gateway/model_credential_error';
import { llm_proxy_credential_env_names } from '@agent-core/llm_gateway/model_resolver';
import { AppError } from '@coworker/shared';

export type ModelCredentialRequest = {
  model_provider: string | null;
  model_proxy: string | null;
};

export function runtime_model_error(error: unknown, request: ModelCredentialRequest) {
  if (error instanceof MissingModelProxyCredentialError && request.model_proxy) {
    return missing_model_proxy_key_error(error.model_proxy);
  }
  if (error instanceof MissingModelProxyCredentialError) {
    return missing_model_proxy_key_error(
      error.model_proxy,
      request.model_provider ?? error.model_proxy,
    );
  }
  if (error instanceof MissingEveryModelProxyCredentialError) {
    return missing_every_model_credential_error(error.credential_env_names);
  }

  return error;
}

/** Resolves a route, and answers null when no credential was there to resolve it with. */
export function route_or_null_without_a_credential<Route>(resolve_route: () => Route) {
  try {
    return resolve_route();
  } catch (error) {
    if (error instanceof AppError && error.code === 'model_proxy_not_configured') return null;
    throw error;
  }
}

export function runtime_model_credential_env_names(proxy_name: string) {
  return llm_proxy_credential_env_names(proxy_name);
}

function missing_model_proxy_key_error(proxy_name: string, inferred_from_provider?: string) {
  const credential_env_names = runtime_model_credential_env_names(proxy_name);
  return new AppError(
    'model_proxy_not_configured',
    `No API key configured for model proxy: ${proxy_name}. Set ${credential_env_names.join(' or ')}.`,
    500,
    {
      ...(inferred_from_provider ? { model_provider: inferred_from_provider } : {}),
      model_proxy: proxy_name,
      credential_env_names,
    },
  );
}

function missing_every_model_credential_error(credential_env_names: string[]) {
  return new AppError(
    'model_proxy_not_configured',
    `No model proxy API key configured. Set ${credential_env_names.join(', ')}.`,
    500,
    { credential_env_names },
  );
}
