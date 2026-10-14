import { list_models, type ModelCatalogEnvironment } from '@api/services/models/model_catalog';
import { list_models_dev_catalog } from '@api/services/models/models_dev_catalog';
import {
  type KeyThatUnlocksAModel,
  list_models_that_need_a_key,
} from '@api/services/models/models_that_need_a_key';
import { list_configured_model_proxies } from '@coworker/runtime-platform';

/**
 * The models the picker lists. A self-hosted install also lists every model a key it does not
 * hold yet would reach, so its owner sees the whole catalog and which key unlocks each model.
 */
export async function list_models_for_the_picker(model_environment: ModelCatalogEnvironment) {
  const { environment } = model_environment;
  if (environment.COWORKER_SELF_HOSTED !== 'true') {
    return (await list_models(model_environment)).map(needs_no_new_key);
  }
  const holds_a_key = list_configured_model_proxies(environment).length > 0;
  const usable_models = holds_a_key ? await list_models(model_environment) : [];
  const models_that_need_a_key = list_models_that_need_a_key({
    catalog: await list_models_dev_catalog(),
    environment,
    usable_models,
  });
  return [...usable_models.map(needs_no_new_key), ...models_that_need_a_key];
}

function needs_no_new_key<Model>(model: Model) {
  return { ...model, keys_that_unlock_this_model: [] as KeyThatUnlocksAModel[] };
}
