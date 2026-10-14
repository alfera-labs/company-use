import { add_models_dev_models } from '@agent-core/engines/pi/pi_models_from_models_dev';
import { create_pi_provider_at_operator_address } from '@agent-core/engines/pi/pi_provider_at_operator_address';
import { create_pi_provider_with_payload_rewrite } from '@agent-core/engines/pi/pi_provider_with_payload_rewrite';
import { read_process_env } from '@agent-core/llm_gateway/model_resolver';
import {
  list_model_proxies,
  type ModelProxy,
  model_proxy_credential_env_names,
  pi_provider_name_of_proxy,
} from '@coworker/shared';
import {
  createModels,
  envApiKeyAuth,
  InMemoryCredentialStore,
  type Models,
} from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';

type PiProvider = ReturnType<typeof builtinProviders>[number];

const providers_by_name = new Map(
  builtinProviders().map((provider) => [provider.id, provider] as const),
);
const runtime_pi_models = create_configured_pi_models();

export function get_pi_models(): Models {
  return runtime_pi_models;
}

export async function create_authenticated_pi_models(
  pi_provider_name: string,
  api_key: string,
): Promise<Models> {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(pi_provider_name, async () => ({ type: 'api_key', key: api_key }));
  return create_configured_pi_models(credentials);
}

function create_configured_pi_models(credentials?: InMemoryCredentialStore): Models {
  const models = createModels(credentials ? { credentials } : undefined);
  for (const proxy of list_model_proxies()) {
    models.setProvider(
      proxy.reach_models_at_the_address_in_env
        ? create_pi_provider_at_operator_address(proxy, read_process_env())
        : create_built_in_pi_provider(proxy),
    );
  }
  return models;
}

function create_built_in_pi_provider(proxy: ModelProxy): PiProvider {
  const pi_provider_name = proxy.reach_models_through_pi_provider;
  const provider = providers_by_name.get(pi_provider_name);
  if (!provider) {
    throw new Error(`Pi provider ${pi_provider_name} is configured but is not included in Pi AI`);
  }
  const with_catalog_models = accept_a_token_this_platform_resolved(
    add_models_dev_models(provider, proxy.models_dev_provider_name),
  );
  const rewrite = proxy.rewrite_provider_payload_as;
  return rewrite
    ? create_pi_provider_with_payload_rewrite(with_catalog_models, {
        ...proxy,
        rewrite_provider_payload_as: rewrite,
      })
    : with_catalog_models;
}

// A subscription provider (OpenAI Codex) authenticates only through pi's own interactive OAuth
// login, which stores its tokens next to whoever ran it. This platform owns that sign-in instead:
// it holds one token pair per workspace and renews it before the run. So the provider is taught to
// accept an already-resolved bearer token, the way every other provider accepts its key, and pi
// never has a stored credential of its own to refresh behind our back.
function accept_a_token_this_platform_resolved(provider: PiProvider): PiProvider {
  if (provider.auth.apiKey) return provider;

  const proxy = list_model_proxies().find(
    (candidate) => pi_provider_name_of_proxy(candidate) === provider.id,
  );
  const env_names = proxy ? model_proxy_credential_env_names(proxy.model_proxy) : [];
  return {
    ...provider,
    auth: { ...provider.auth, apiKey: envApiKeyAuth(provider.name, env_names) },
  };
}
