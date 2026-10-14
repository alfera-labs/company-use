import { find_model_rating } from '@api/services/models/model_ratings';
import { format_provider_display_name } from '@api/services/models/provider_display_name';
import {
  type list_configured_model_proxies,
  type ModelsDevCatalog,
  type ModelsDevModel,
  model_provider_for_proxy,
} from '@coworker/runtime-platform';

type ConfiguredProxy = ReturnType<typeof list_configured_model_proxies>[number];
export type RecommendedModel = { model_proxy: string; model_name: string } | null;
export type ModelCatalogEntry = ReturnType<typeof normalize_model>;

const models_dev_logo_url = 'https://models.dev/logos';

export function model_provider_logo_url(models_dev_provider_name: string) {
  return `${models_dev_logo_url}/${models_dev_provider_name}.svg`;
}

export function normalize_model(
  model: ModelsDevModel,
  proxy: ConfiguredProxy,
  catalog: ModelsDevCatalog,
  recommended_model: RecommendedModel,
) {
  const model_provider = model_provider_for_proxy(proxy.model_proxy, model.id);
  const provider = catalog[model_provider];
  const model_family = model.family ?? null;
  const rating = find_model_rating({ model_display_name: model.name, model_family });

  return {
    model_id: model.id,
    model_display_name: model.name,
    model_family,
    release_date: model.release_date ?? null,
    model_provider,
    model_provider_display_name: format_provider_display_name({
      catalog_name: provider?.name,
      model_provider,
    }),
    model_provider_logo_url: provider ? model_provider_logo_url(model_provider) : null,
    model_proxy: proxy.model_proxy,
    model_proxy_display_name: proxy.display_name,
    description: model.description ?? null,
    context_window: model.limit.context,
    max_output_tokens: model.limit.output ?? null,
    model_type: 'language',
    input_modalities: model.modalities.input,
    output_modalities: model.modalities.output,
    supports_tool_calls: model.tool_call ?? false,
    supports_reasoning: model.reasoning ?? false,
    speed_out_of_five: rating?.speed_out_of_five ?? null,
    intelligence_out_of_five: rating?.intelligence_out_of_five ?? null,
    is_recommended_for_agent_runs:
      recommended_model?.model_proxy === proxy.model_proxy &&
      recommended_model.model_name === model.id,
  };
}

export function compare_models(left: ModelCatalogEntry, right: ModelCatalogEntry) {
  return (
    left.model_provider_display_name.localeCompare(right.model_provider_display_name) ||
    left.model_proxy.localeCompare(right.model_proxy) ||
    (right.release_date ?? '').localeCompare(left.release_date ?? '') ||
    left.model_display_name.localeCompare(right.model_display_name)
  );
}
