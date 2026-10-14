import { reasoning_levels } from '@shared/model_configuration_schema';
import { z } from 'zod';

export const model_provider_schema = z.string().trim().min(1).max(80);
export const model_proxy_schema = z.string().trim().min(1).max(80);
export const model_name_schema = z.string().trim().min(1).max(200);

export const agent_model_config_schema = z
  .object({
    model_provider: model_provider_schema.nullish(),
    model_proxy: model_proxy_schema.nullish(),
    model_name: model_name_schema.nullish(),
    reasoning_level: z.enum(reasoning_levels).nullish(),
    temperature: z.number().min(0).max(2).nullish(),
    max_output_tokens: z.number().int().min(1).max(128_000).nullish(),
  })
  .passthrough();
