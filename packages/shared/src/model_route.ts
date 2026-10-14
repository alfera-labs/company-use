import { find_model_proxy, find_model_proxy_for_model_id } from '@shared/model_configuration';
import {
  is_model_id_shaped_for_proxy,
  read_model_provider,
  read_model_provider_name,
} from '@shared/model_proxy_record';

export type ModelRoute = {
  model_provider: string;
  model_proxy: string;
  model_name: string;
};

export type ModelRouteInput = {
  model_provider?: string | null | undefined;
  model_proxy?: string | null | undefined;
  model_name?: string | null | undefined;
};

type ModelRouteIssue = {
  field: keyof ModelRoute;
  message: string;
};

export type NormalizedModelRoute =
  | { success: true; route: ModelRoute | null }
  | { success: false; issues: ModelRouteIssue[] };

export function normalize_model_route(input: ModelRouteInput): NormalizedModelRoute {
  const model_provider = normalized_identifier(input.model_provider);
  const requested_proxy = normalized_identifier(input.model_proxy);
  const model_name = input.model_name?.trim() || null;
  if (!model_provider && !requested_proxy && !model_name) return { success: true, route: null };
  if (!model_name) {
    return {
      success: false,
      issues: [{ field: 'model_name', message: 'A model route must identify its model.' }],
    };
  }

  const proxy = find_requested_model_proxy({ model_provider, requested_proxy, model_name });
  if (!proxy) {
    return {
      success: false,
      issues: [
        {
          field: 'model_proxy',
          message: requested_proxy
            ? `Unknown model proxy: ${requested_proxy}.`
            : `No configured model proxy accepts model ${model_name}.`,
        },
      ],
    };
  }
  if (!is_model_id_shaped_for_proxy(proxy, model_name)) {
    return {
      success: false,
      issues: [
        {
          field: 'model_name',
          message: `Model ${model_name} is not shaped for model proxy ${proxy.model_proxy}.`,
        },
      ],
    };
  }

  const derived_provider = read_model_provider(proxy, model_name);
  if (
    model_provider &&
    read_model_provider_name(proxy, model_provider) !== derived_provider &&
    !names_this_proxy(proxy, model_provider)
  ) {
    return {
      success: false,
      issues: [
        {
          field: 'model_provider',
          message: `Model provider ${model_provider} does not match model ${model_name}.`,
        },
      ],
    };
  }

  return {
    success: true,
    route: {
      model_provider: derived_provider,
      model_proxy: proxy.model_proxy,
      model_name,
    },
  };
}

function find_requested_model_proxy(input: {
  model_provider: string | null;
  requested_proxy: string | null;
  model_name: string;
}) {
  if (input.requested_proxy) return find_model_proxy(input.requested_proxy);
  if (input.model_provider) {
    const provider_proxy = find_model_proxy(input.model_provider);
    if (provider_proxy && is_model_id_shaped_for_proxy(provider_proxy, input.model_name)) {
      return provider_proxy;
    }
  }

  return find_model_proxy_for_model_id(input.model_name);
}

function names_this_proxy(proxy: { model_proxy: string }, name: string) {
  return find_model_proxy(name)?.model_proxy === proxy.model_proxy;
}

function normalized_identifier(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}
