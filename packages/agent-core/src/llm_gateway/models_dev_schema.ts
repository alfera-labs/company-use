import { z } from 'zod';

const model_modalities_schema = z
  .object({
    input: z.array(z.string()),
    output: z.array(z.string()),
  })
  .strict();

const model_limit_schema = z
  .object({
    context: z.number().int().nonnegative(),
    output: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const model_cost_schema = z
  .object({
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    cache_read: z.number().nonnegative().optional(),
    cache_write: z.number().nonnegative().optional(),
  })
  .passthrough();

const models_dev_model_schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    family: z.string().optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    temperature: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    modalities: model_modalities_schema,
    limit: model_limit_schema,
    cost: model_cost_schema.optional(),
    release_date: z.string().optional(),
    last_updated: z.string().optional(),
    status: z.string().min(1).optional(),
  })
  .passthrough();

const models_dev_provider_schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    models: z.record(z.string(), models_dev_model_schema),
  })
  .passthrough();

export const models_dev_catalog_schema = z.record(z.string(), models_dev_provider_schema);

export type ModelsDevCatalog = z.infer<typeof models_dev_catalog_schema>;
export type ModelsDevModel = z.infer<typeof models_dev_model_schema>;
