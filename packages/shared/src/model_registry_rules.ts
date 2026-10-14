import type {
  LanguageModelUseCase,
  ModelProfile,
  ModelProxy,
  ModelUseCasePolicy,
} from '@shared/model_configuration_schema';

export type ModelRegistry = {
  model_proxies: ModelProxy[];
  model_use_case_policies: Partial<Record<LanguageModelUseCase, ModelUseCasePolicy>>;
  model_profiles: Record<string, ModelProfile>;
};

export function validate_model_registry(registry: ModelRegistry) {
  validate_proxy_references(registry);
  validate_one_catch_all_proxy(registry.model_proxies);
  validate_one_proxy_offers_each_model_provider(registry.model_proxies);
}

function validate_proxy_references(registry: ModelRegistry) {
  const canonical_names = new Set(registry.model_proxies.map((proxy) => proxy.model_proxy));
  const references = [
    ...Object.entries(registry.model_use_case_policies).flatMap(([use_case, policy]) =>
      policy.try_proxies_in_order.map((name) => ({ owner: `Use case ${use_case}`, name })),
    ),
    ...Object.values(registry.model_profiles).map((profile) => ({
      owner: 'Model profile',
      name: profile.model_proxy_when_env_is_unset,
    })),
  ];
  for (const { owner, name } of references) {
    if (canonical_names.has(name)) continue;
    throw new Error(
      `${owner} lists unknown model proxy ${name}. Configured proxies: ${[...canonical_names].join(', ')}.`,
    );
  }
}

function validate_one_catch_all_proxy(model_proxies: ModelProxy[]) {
  require_at_most_one_catch_all(
    model_proxies,
    'claim unmatched model ids',
    (proxy) => proxy.claim_model_ids_no_other_proxy_claims === true,
  );
}

function require_at_most_one_catch_all(
  model_proxies: ModelProxy[],
  role: string,
  is_catch_all: (proxy: ModelProxy) => boolean,
) {
  const catch_all_proxies = model_proxies.filter(is_catch_all);
  if (catch_all_proxies.length <= 1) return;
  throw new Error(
    `Only one model proxy may ${role}: ${catch_all_proxies.map((proxy) => proxy.model_proxy).join(', ')}`,
  );
}

function validate_one_proxy_offers_each_model_provider(model_proxies: ModelProxy[]) {
  const offering_proxy_by_model_provider = new Map<string, ModelProxy>();

  for (const proxy of model_proxies) {
    for (const model_provider of proxy.offer_models_made_by ?? []) {
      const already_offered_by = offering_proxy_by_model_provider.get(model_provider);
      if (already_offered_by) {
        throw new Error(
          `Models made by ${model_provider} are offered by both ${already_offered_by.model_proxy} and ${proxy.model_proxy}`,
        );
      }
      offering_proxy_by_model_provider.set(model_provider, proxy);
    }
  }
}
