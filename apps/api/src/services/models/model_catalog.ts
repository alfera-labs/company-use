import {
  compare_models,
  type ModelCatalogEntry,
  normalize_model,
  type RecommendedModel,
} from '@api/services/models/model_catalog_entry';
import {
  deployment_model_environment as deployment_environment,
  type ModelCatalogEnvironment,
} from '@api/services/models/model_catalog_environment';
import { model_proxy_not_configured } from '@api/services/models/model_proxy_not_configured';
import {
  clear_models_dev_catalog_cache,
  list_models_dev_catalog,
} from '@api/services/models/models_dev_catalog';
import { list_models_named_in_env } from '@api/services/models/models_named_in_env';
import {
  find_configured_model_proxy,
  find_model_proxy_definition,
  list_configured_model_proxies,
  list_model_ids_for_proxy,
  type ModelsDevCatalog,
  type ModelsDevModel,
  model_provider_for_proxy,
  resolve_model,
} from '@coworker/runtime-platform';
import {
  create_logger,
  find_model_proxy_offering_models_made_by,
  list_model_ids_the_proxy_offers,
  ValidationError,
} from '@coworker/shared';

type ConfiguredProxy = ReturnType<typeof list_configured_model_proxies>[number];

export type { ModelCatalogEntry } from '@api/services/models/model_catalog_entry';

const log = create_logger('model_catalog');

export {
  type ModelCatalogEnvironment,
  read_workspace_model_catalog_environment,
} from '@api/services/models/model_catalog_environment';

export async function list_models(
  model_environment: ModelCatalogEnvironment = deployment_environment(),
): Promise<ModelCatalogEntry[]> {
  return list_every_runnable_model(model_environment.environment);
}

export async function get_model(input: {
  model_proxy: string;
  model_id: string;
  model_environment?: ModelCatalogEnvironment;
}) {
  const environment = (input.model_environment ?? deployment_environment()).environment;
  const proxy = find_model_proxy_definition(input.model_proxy);
  if (!proxy) {
    throw new ValidationError(`Unknown model proxy: ${input.model_proxy}`);
  }
  if (!find_configured_model_proxy(proxy.model_proxy, environment)) {
    throw model_proxy_not_configured(proxy.model_proxy);
  }

  const models = await list_every_runnable_model(environment);
  const model = models.find(
    (candidate) =>
      candidate.model_proxy === proxy.model_proxy && candidate.model_id === input.model_id,
  );
  if (model) return model;

  throw new ValidationError(
    `Model ${input.model_id} is not available through model proxy ${proxy.model_proxy}`,
  );
}

export function clear_model_catalog_cache() {
  clear_models_dev_catalog_cache();
}

async function list_every_runnable_model(
  environment: Record<string, string | undefined>,
): Promise<ModelCatalogEntry[]> {
  const proxies = list_configured_model_proxies(environment);
  if (proxies.length === 0) throw model_proxy_not_configured();

  const catalog = await list_models_dev_catalog();
  const recommended_model = resolve_recommended_model(environment);
  return proxies
    .flatMap((proxy) =>
      proxy.run_only_the_models_named_in_env
        ? list_models_named_in_env(proxy, environment, recommended_model)
        : list_proxy_models({ proxy, proxies, catalog, recommended_model, environment }),
    )
    .sort(compare_models);
}

function resolve_recommended_model(
  environment: Record<string, string | undefined>,
): RecommendedModel {
  try {
    const model = resolve_model({}, { environment, workspace_owned_env_names: new Set<string>() });
    return { model_proxy: model.model_proxy, model_name: model.model_name };
  } catch (error) {
    log.warn('no recommended model could be resolved for agent runs', error);
    return null;
  }
}

function list_proxy_models(input: {
  proxy: ConfiguredProxy;
  proxies: ConfiguredProxy[];
  catalog: ModelsDevCatalog;
  recommended_model: RecommendedModel;
  environment: Record<string, string | undefined>;
}) {
  const { proxy, catalog } = input;
  const listed_model_ids = read_listed_model_ids(proxy, input.environment);
  return list_models_agents_can_run_through(proxy, catalog)
    .filter((model) =>
      listed_model_ids
        ? listed_model_ids.has(model.id)
        : is_model_offered_by_this_proxy(proxy, model, input.proxies),
    )
    .map((model) => normalize_model(model, proxy, catalog, input.recommended_model));
}

export function list_models_agents_can_run_through(
  proxy: Pick<ConfiguredProxy, 'model_proxy' | 'models_dev_provider_name'>,
  catalog: ModelsDevCatalog,
) {
  const provider = catalog[proxy.models_dev_provider_name];
  if (!provider) return [];

  const runnable_model_ids = new Set(list_model_ids_for_proxy(proxy.model_proxy));
  return Object.values(provider.models)
    .filter((model) => runnable_model_ids.has(model.id))
    .filter(agents_can_run_this_model)
    .filter(is_current_model);
}

function read_listed_model_ids(
  proxy: ConfiguredProxy,
  environment: Record<string, string | undefined>,
) {
  const listed = list_model_ids_the_proxy_offers(proxy, environment);
  return listed ? new Set(listed) : undefined;
}

function is_model_offered_by_this_proxy(
  proxy: ConfiguredProxy,
  model: ModelsDevModel,
  configured_proxies: ConfiguredProxy[],
) {
  const model_provider = model_provider_for_proxy(proxy.model_proxy, model.id);
  const offering_proxy = find_model_proxy_offering_models_made_by(
    model_provider,
    configured_proxies,
  );

  return offering_proxy?.model_proxy === proxy.model_proxy;
}

const current_model_window_ms = 365 * 24 * 60 * 60 * 1000;
function is_current_model(model: ModelsDevModel) {
  if (model.status === 'deprecated') return false;
  if (!model.release_date) return true;
  return Date.parse(model.release_date) >= Date.now() - current_model_window_ms;
}

function agents_can_run_this_model(model: ModelsDevModel) {
  return (
    model.tool_call === true &&
    model.modalities.output.includes('text') &&
    model.limit.context > 0 &&
    (model.limit.output === undefined || model.limit.output > 0)
  );
}
