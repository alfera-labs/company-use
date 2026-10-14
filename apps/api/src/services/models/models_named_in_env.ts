import type { ModelCatalogEntry } from '@api/services/models/model_catalog';
import {
  list_models_named_in_env_for_proxy,
  model_provider_for_proxy,
} from '@coworker/runtime-platform';

type ProxyWithModelsNamedInEnv = { model_proxy: string; display_name: string };

/**
 * The catalog entries of a proxy that runs only the models its operator named. No public
 * catalog knows such a model, so an entry holds its name and what is assumed about it, and
 * nothing is made up: no family, no release date, no rating.
 */
export function list_models_named_in_env(
  proxy: ProxyWithModelsNamedInEnv,
  environment: Record<string, string | undefined>,
  recommended_model: { model_proxy: string; model_name: string } | null,
): ModelCatalogEntry[] {
  return list_models_named_in_env_for_proxy(proxy.model_proxy, environment).map((model) => ({
    model_id: model.model_name,
    model_display_name: model.model_name,
    model_family: null,
    release_date: null,
    model_provider: model_provider_for_proxy(proxy.model_proxy, model.model_name),
    model_provider_display_name: proxy.display_name,
    model_provider_logo_url: null,
    model_proxy: proxy.model_proxy,
    model_proxy_display_name: proxy.display_name,
    description: null,
    context_window: model.context_window,
    max_output_tokens: null,
    model_type: 'language',
    input_modalities: model.input_modalities,
    output_modalities: ['text'],
    supports_tool_calls: true,
    supports_reasoning: false,
    speed_out_of_five: null,
    intelligence_out_of_five: null,
    is_recommended_for_agent_runs:
      recommended_model?.model_proxy === proxy.model_proxy &&
      recommended_model.model_name === model.model_name,
  }));
}
