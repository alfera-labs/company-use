import { get_pi_models } from '@agent-core/engines/pi/pi_models';
import { read_process_env } from '@agent-core/llm_gateway/model_resolver';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import {
  find_model_proxy,
  find_model_proxy_credential,
  model_proxy_credential_env_names,
  pi_provider_name_of_proxy,
} from '@coworker/shared';
import type { Api, Model } from '@earendil-works/pi-ai';

export type PiModelDescriptor = {
  model_provider: string;
  model_proxy: string;
  model: string;
  parameters: {
    reasoningLevel?: Exclude<NonNullable<RuntimeModelConfig['reasoning_level']>, 'off'>;
    temperature?: number;
    maxOutputTokens?: number;
  };
};

export function get_pi_model(model: RuntimeModelConfig): Model<Api> | undefined {
  const provider = get_pi_runtime_provider_name(model);
  return get_pi_models().getModel(provider, model.model_name);
}

export function list_pi_model_ids(proxy_name: string) {
  const provider = get_pi_provider_name(proxy_name);
  return get_pi_models()
    .getModels(provider)
    .map((model) => model.id);
}

export function describe_pi_model(model: RuntimeModelConfig): PiModelDescriptor {
  const parameters: PiModelDescriptor['parameters'] = {};

  if (model.reasoning_level && model.reasoning_level !== 'off') {
    parameters.reasoningLevel = model.reasoning_level;
  }

  if (typeof model.temperature === 'number') {
    parameters.temperature = model.temperature;
  }

  if (typeof model.max_output_tokens === 'number') {
    parameters.maxOutputTokens = model.max_output_tokens;
  }

  return {
    model_provider: model.model_provider,
    model_proxy: read_model_proxy_name(model),
    model: model.model_name,
    parameters,
  };
}

export function runtime_model_credential_env_names(model: RuntimeModelConfig) {
  return model_proxy_credential_env_names(read_model_proxy_name(model));
}

export function resolve_runtime_model_api_key(model: RuntimeModelConfig) {
  return (
    model.api_key ??
    find_model_proxy_credential(read_model_proxy_name(model), read_process_env())?.api_key
  );
}

export function get_pi_runtime_provider_name(model: RuntimeModelConfig) {
  return get_pi_provider_name(read_model_proxy_name(model));
}

export function get_pi_provider_name(proxy_name: string) {
  return proxy_pi_provider_name(find_model_proxy(proxy_name)) ?? proxy_name.trim().toLowerCase();
}

function proxy_pi_provider_name(proxy: ReturnType<typeof find_model_proxy>) {
  return proxy ? pi_provider_name_of_proxy(proxy) : undefined;
}

function read_model_proxy_name(model: RuntimeModelConfig) {
  const model_proxy = model.model_proxy ?? model.model_provider;
  return find_model_proxy(model_proxy)?.model_proxy ?? model_proxy;
}
