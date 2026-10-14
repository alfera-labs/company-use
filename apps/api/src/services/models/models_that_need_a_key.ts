import { list_models_agents_can_run_through } from '@api/services/models/model_catalog';
import {
  compare_models,
  type ModelCatalogEntry,
  normalize_model,
} from '@api/services/models/model_catalog_entry';
import { type ApiKeySlot, api_key_slots } from '@api/services/models/model_key_checks';
import { model_provider_account_slots } from '@coworker/core/integrations/model_provider_account_slots';
import type { ModelsDevCatalog, ModelsDevModel } from '@coworker/runtime-platform';
import {
  find_model_proxy,
  find_model_proxy_credential,
  is_model_proxy_served_on_this_install,
  type ModelProxy,
  read_model_provider,
} from '@coworker/shared';

export type KeyThatUnlocksAModel = { provider_slot: ApiKeySlot; display_name: string };

type KeyProxy = { provider_slot: ApiKeySlot; proxy: ModelProxy };

type ModelThatNeedsAKey = ModelCatalogEntry & {
  keys_that_unlock_this_model: KeyThatUnlocksAModel[];
};

/**
 * Every model a key the install does not hold yet would reach, with the keys that reach it: its
 * own provider's key first, then the one key that reaches most models, when that key reaches it.
 */
export function list_models_that_need_a_key(input: {
  catalog: ModelsDevCatalog;
  environment: Record<string, string | undefined>;
  usable_models: ModelCatalogEntry[];
}): ModelThatNeedsAKey[] {
  const key_proxies = list_key_proxies_not_connected(input.environment);
  const one_key_for_every_model = key_proxies.find(
    ({ proxy }) => proxy.suggest_as_one_key_for_every_model,
  );
  const reached_by_one_key = new Set(
    one_key_for_every_model ? list_model_keys(one_key_for_every_model.proxy, input.catalog) : [],
  );
  const usable_model_providers = new Set(input.usable_models.map((model) => model.model_provider));
  const own_key_model_providers = new Set(
    key_proxies.flatMap(({ proxy }) => proxy.offer_models_made_by ?? []),
  );
  const listed = new Set<string>();

  return key_proxies
    .flatMap((key_proxy) =>
      list_models_agents_can_run_through(key_proxy.proxy, input.catalog).flatMap((model) => {
        const model_provider = read_model_provider(key_proxy.proxy, model.id);
        const model_key = read_model_key(key_proxy.proxy, model);
        const has_own_key_elsewhere =
          !key_proxy.proxy.offer_models_made_by && own_key_model_providers.has(model_provider);
        if (usable_model_providers.has(model_provider) || has_own_key_elsewhere) return [];
        if (listed.has(model_key)) return [];
        listed.add(model_key);
        const one_key =
          one_key_for_every_model &&
          one_key_for_every_model !== key_proxy &&
          reached_by_one_key.has(model_key)
            ? [one_key_for_every_model]
            : [];
        return [
          {
            ...normalize_model(model, key_proxy.proxy, input.catalog, null),
            keys_that_unlock_this_model: [key_proxy, ...one_key].map(describe_key),
          },
        ];
      }),
    )
    .sort(compare_models);
}

function list_key_proxies_not_connected(environment: Record<string, string | undefined>) {
  return api_key_slots
    .flatMap((provider_slot): KeyProxy[] => {
      const proxy = find_model_proxy(model_provider_account_slots[provider_slot].model_proxy);
      return proxy ? [{ provider_slot, proxy }] : [];
    })
    .filter(({ proxy }) => is_model_proxy_served_on_this_install(proxy, environment))
    .filter(({ proxy }) => !find_model_proxy_credential(proxy.model_proxy, environment))
    .sort((left, right) => suggestion_rank(left.proxy) - suggestion_rank(right.proxy));
}

function suggestion_rank(proxy: ModelProxy) {
  if (proxy.offer_models_made_by) return 0;
  return proxy.suggest_as_one_key_for_every_model ? 1 : 2;
}

function list_model_keys(proxy: ModelProxy, catalog: ModelsDevCatalog) {
  return list_models_agents_can_run_through(proxy, catalog).map((model) =>
    read_model_key(proxy, model),
  );
}

function read_model_key(proxy: ModelProxy, model: ModelsDevModel) {
  const model_name = model.id.split('/').at(-1) ?? model.id;
  const comparable_name = model_name.toLowerCase().replaceAll('.', '-');
  return `${read_model_provider(proxy, model.id)}:${comparable_name}`;
}

function describe_key(key_proxy: KeyProxy): KeyThatUnlocksAModel {
  return { provider_slot: key_proxy.provider_slot, display_name: key_proxy.proxy.display_name };
}
