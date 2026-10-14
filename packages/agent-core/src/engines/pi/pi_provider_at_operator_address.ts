import {
  find_model_proxy_credential,
  list_model_names_in_env,
  type ModelProxy,
} from '@coworker/shared';
import { type Api, createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

type Environment = Record<string, string | undefined>;

const context_window_when_env_is_unset = 32_768;
const largest_answer_in_tokens = 16_384;

const fields_every_chat_completions_server_accepts = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
  maxTokensField: 'max_tokens',
} as const;

/**
 * The provider for a server the operator names by address. Nothing is known about a model
 * there, so every value is the one that is safe when wrong: no price, text only, and a context
 * window that only compacts a session earlier when it is assumed too small. The request leaves
 * out every field only some servers accept: `store`, the `developer` role, reasoning effort,
 * strict tool schemas and the prompt cache fields.
 */
export function create_pi_provider_at_operator_address(
  proxy: ModelProxy,
  environment: Environment,
) {
  const address = read_operator_address(proxy, environment);
  const model_names = address
    ? new Set([...list_model_names_in_env(proxy, environment), proxy.model_name_when_env_is_unset])
    : [];

  return createProvider<Api>({
    id: proxy.reach_models_through_pi_provider,
    name: proxy.display_name,
    baseUrl: address,
    auth: {
      apiKey: envApiKeyAuth(proxy.display_name, proxy.authenticate_with_first_env_name_present),
    },
    models: [...model_names].map((model_name) =>
      model_nothing_is_known_about({ proxy, environment, address, model_name }),
    ),
    api: openAICompletionsApi(),
  });
}

function read_operator_address(proxy: ModelProxy, environment: Environment) {
  if (!find_model_proxy_credential(proxy.model_proxy, environment)) return '';
  return environment[proxy.reach_models_at_the_address_in_env ?? '']?.trim() ?? '';
}

function model_nothing_is_known_about(input: {
  proxy: ModelProxy;
  environment: Environment;
  address: string;
  model_name: string;
}): Model<'openai-completions'> {
  const env_prefix = input.proxy.read_model_names_from_env_prefixed;
  const reads_images = ['true', '1'].includes(
    input.environment[`${env_prefix}_READS_IMAGES`]?.trim() ?? '',
  );

  return {
    id: input.model_name,
    name: input.model_name,
    api: 'openai-completions',
    provider: input.proxy.reach_models_through_pi_provider,
    baseUrl: input.address,
    reasoning: false,
    input: reads_images ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: read_context_window(input.environment[`${env_prefix}_CONTEXT_WINDOW`]),
    maxTokens: largest_answer_in_tokens,
    compat: fields_every_chat_completions_server_accepts,
  };
}

function read_context_window(setting: string | undefined) {
  const tokens = Number(setting?.trim());
  return Number.isInteger(tokens) && tokens > 0 ? tokens : context_window_when_env_is_unset;
}
