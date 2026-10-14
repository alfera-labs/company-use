import type { ModelReasoningLevel } from '@coworker/shared';

export type RuntimeReasoningLevel = ModelReasoningLevel;

export type RuntimeModelConfig = {
  model_provider: string;
  model_name: string;
  model_proxy?: string;
  api_key?: string;
  reasoning_level?: RuntimeReasoningLevel;
  temperature?: number;
  max_output_tokens?: number;
};

export function model_config_without_credential(model: RuntimeModelConfig): RuntimeModelConfig {
  const { api_key: _api_key, ...describable } = model;
  return describable;
}
