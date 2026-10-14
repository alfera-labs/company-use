import { get_pi_model, list_pi_model_ids } from '@agent-core/engines/pi/pi_model';
import { models_dev_catalog_schema } from '@agent-core/llm_gateway';
import models_dev_snapshot_data from '@agent-core/llm_gateway/models_dev_snapshot.json' with {
  type: 'json',
};
import { env } from '@coworker/config';
import {
  find_model_proxy,
  find_model_proxy_credential,
  is_model_proxy_served_on_this_install,
  list_model_names_in_env,
  list_model_proxies,
  type ModelProxyEnvironment,
  parse_json_config,
  read_model_provider,
  require_model_catalog_source,
  require_model_proxy,
} from '@coworker/shared';

export {
  type ModelsDevCatalog,
  type ModelsDevModel,
  models_dev_catalog_schema,
} from '@agent-core/llm_gateway';

export function list_model_ids_for_proxy(proxy_name: string) {
  return list_pi_model_ids(proxy_name);
}

/** The models the operator named in a proxy's env settings, with what is assumed about each. */
export function list_models_named_in_env_for_proxy(
  proxy_name: string,
  environment: ModelProxyEnvironment,
) {
  const proxy = require_model_proxy(proxy_name);
  return list_model_names_in_env(proxy, environment).flatMap((model_name) => {
    const model = get_pi_model({
      model_provider: read_model_provider(proxy, model_name),
      model_proxy: proxy.model_proxy,
      model_name,
    });
    return model
      ? [{ model_name, context_window: model.contextWindow, input_modalities: model.input }]
      : [];
  });
}

export function list_configured_model_proxies(environment: ModelProxyEnvironment) {
  return list_model_proxies().filter((proxy) =>
    find_model_proxy_credential(proxy.model_proxy, environment),
  );
}

export function list_model_proxy_definitions() {
  return list_model_proxies().filter((proxy) => is_model_proxy_served_on_this_install(proxy, env));
}

export function find_configured_model_proxy(
  model_proxy: string,
  environment: ModelProxyEnvironment,
) {
  const proxy = require_model_proxy(model_proxy);
  return find_model_proxy_credential(proxy.model_proxy, environment) ? proxy : undefined;
}

export function find_model_proxy_definition(model_proxy: string) {
  const proxy = find_model_proxy(model_proxy);
  return proxy && is_model_proxy_served_on_this_install(proxy, env) ? proxy : undefined;
}

export function model_provider_for_proxy(proxy_name: string, model_id: string) {
  return read_model_provider(require_model_proxy(proxy_name), model_id);
}

export function get_bundled_models_dev_catalog() {
  return parse_json_config(
    'models_dev_snapshot.json',
    models_dev_catalog_schema,
    models_dev_snapshot_data,
  );
}

export function get_models_dev_catalog_source() {
  return require_model_catalog_source('models_dev');
}
