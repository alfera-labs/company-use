import { env } from '@coworker/config';
import { model_catalog_refreshes_by_default } from '@coworker/config/hosted_defaults';
import {
  get_bundled_models_dev_catalog,
  get_models_dev_catalog_source,
  type ModelsDevCatalog,
  models_dev_catalog_schema,
} from '@coworker/runtime-platform';
import { create_logger, format_error_message, parse_json_config } from '@coworker/shared';

const models_dev_source = get_models_dev_catalog_source();
const log = create_logger('model_catalog');

type CachedCatalog = {
  catalog: ModelsDevCatalog;
  expires_time: number;
};

let cached_catalog = snapshot_cache();
let pending_catalog: Promise<void> | undefined;
let cache_generation = 0;

export async function list_models_dev_catalog(): Promise<ModelsDevCatalog> {
  const catalog = cached_catalog.catalog;
  if (refreshes_from_models_dev() && cached_catalog.expires_time <= Date.now()) {
    start_catalog_refresh();
  }
  return catalog;
}

function refreshes_from_models_dev() {
  return env.MODEL_CATALOG_REFRESH ?? model_catalog_refreshes_by_default;
}

function start_catalog_refresh() {
  if (pending_catalog) return;

  const generation = cache_generation;
  const refresh = refresh_models_dev_catalog(generation);
  pending_catalog = refresh;
  void refresh.finally(() => {
    if (pending_catalog === refresh) pending_catalog = undefined;
  });
}

export function clear_models_dev_catalog_cache() {
  cache_generation += 1;
  cached_catalog = snapshot_cache();
  pending_catalog = undefined;
}

async function refresh_models_dev_catalog(generation: number) {
  try {
    const catalog = await fetch_models_dev_catalog();
    if (generation !== cache_generation) return;
    cached_catalog = {
      catalog,
      expires_time: Date.now() + models_dev_source.refresh_after_ms,
    };
  } catch (error) {
    if (generation !== cache_generation) return;
    log.warn(
      'models.dev refresh failed; serving the last known model catalog',
      bounded_refresh_error(error),
    );
    cached_catalog.expires_time = Date.now() + models_dev_source.retry_after_failure_ms;
  }
}

async function fetch_models_dev_catalog() {
  const response = await fetch(models_dev_source.fetch_from, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(models_dev_source.request_timeout_ms),
  });
  if (!response.ok) {
    throw new Error(`models.dev returned status ${response.status}`);
  }

  const payload = await response.json();
  return parse_json_config('the models.dev catalog', models_dev_catalog_schema, payload);
}

function snapshot_cache(): CachedCatalog {
  return {
    catalog: get_bundled_models_dev_catalog(),
    expires_time: 0,
  };
}

function bounded_refresh_error(error: unknown) {
  const message = format_error_message(error);
  const maximum_message_length = 500;
  return {
    error_name: error instanceof Error ? error.name : 'UnknownError',
    error_message:
      message.length <= maximum_message_length
        ? message
        : `${message.slice(0, maximum_message_length)}…`,
  };
}
