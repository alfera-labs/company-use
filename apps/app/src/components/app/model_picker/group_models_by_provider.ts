import { searchable_model_text } from '@/components/app/model_picker/model_display';
import type { ModelCatalogEntry } from '@/lib/api';
import { matches_every_word } from '@/lib/text_search';

type ProviderModels = { model_provider: string; display_name: string; models: ModelCatalogEntry[] };

export function needs_a_new_key(model: ModelCatalogEntry) {
  return (model.keys_that_unlock_this_model ?? []).length > 0;
}

/** The models that match the search, by provider: providers with a usable model first. */
export function group_models_by_provider(models: ModelCatalogEntry[], query: string) {
  const providers = new Map<string, ProviderModels>();

  for (const model of models) {
    if (!matches_every_word(searchable_model_text(model), query)) continue;
    const provider = providers.get(model.model_provider) ?? {
      model_provider: model.model_provider,
      display_name: model.model_provider_display_name,
      models: [],
    };
    provider.models.push(model);
    providers.set(model.model_provider, provider);
  }

  return [...providers.values()].sort(
    (left, right) =>
      Number(left.models.every(needs_a_new_key)) - Number(right.models.every(needs_a_new_key)) ||
      left.display_name.localeCompare(right.display_name),
  );
}
