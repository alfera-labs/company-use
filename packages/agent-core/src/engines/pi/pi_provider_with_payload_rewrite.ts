import { rewrite_payload_for_chatgpt_plan } from '@agent-core/engines/pi/chatgpt_plan_payload';
import {
  type ModelProxy,
  type ProviderPayloadRewrite,
  pi_provider_name_of_proxy,
} from '@coworker/shared';
import { type Api, envApiKeyAuth, type Model, type Provider } from '@earendil-works/pi-ai';

type StreamOptions = Parameters<Provider['streamSimple']>[2];

const payload_rewrites: Record<ProviderPayloadRewrite, (payload: unknown) => unknown> = {
  chatgpt_plan_responses: rewrite_payload_for_chatgpt_plan,
};

/**
 * A copy of a pi provider whose every request body is rewritten first. The copy lists the same
 * models under its own name, and hands each request to the original as if the original were
 * called, so the original's handling of tool calls and history stays exactly the same.
 */
export function create_pi_provider_with_payload_rewrite(
  source: Provider,
  proxy: ModelProxy & { rewrite_provider_payload_as: ProviderPayloadRewrite },
): Provider {
  const provider_name = pi_provider_name_of_proxy(proxy);
  const rewrite = payload_rewrites[proxy.rewrite_provider_payload_as];
  const as_source_model = <T extends Api>(model: Model<T>) => ({ ...model, provider: source.id });

  return {
    ...source,
    id: provider_name,
    name: proxy.display_name,
    auth: {
      apiKey: envApiKeyAuth(proxy.display_name, proxy.authenticate_with_first_env_name_present),
    },
    getModels: () => source.getModels().map((model) => ({ ...model, provider: provider_name })),
    stream: (model, context, options) =>
      source.stream(as_source_model(model), context, with_rewrite(options, rewrite)),
    streamSimple: (model, context, options) =>
      source.streamSimple(as_source_model(model), context, with_rewrite(options, rewrite)),
  };
}

function with_rewrite<T extends StreamOptions>(
  options: T,
  rewrite: (payload: unknown) => unknown,
): T {
  return {
    ...options,
    onPayload: async (payload: unknown, model: Model<Api>) => {
      const rewritten = rewrite(payload);
      const next = await options?.onPayload?.(rewritten, model);
      return next === undefined ? rewritten : next;
    },
  } as T;
}
