import {
  type ModelsDevModel,
  models_dev_catalog_schema,
} from '@agent-core/llm_gateway/models_dev_schema';
import models_dev_snapshot_data from '@agent-core/llm_gateway/models_dev_snapshot.json' with {
  type: 'json',
};
import type { Api, Model, Provider } from '@earendil-works/pi-ai';

const models_dev_catalog = models_dev_catalog_schema.parse(models_dev_snapshot_data);
const first_family_by_model_id = new Map<string, string>();
for (const provider of Object.values(models_dev_catalog)) {
  for (const [model_id, row] of Object.entries(provider.models)) {
    if (row.family && !first_family_by_model_id.has(model_id))
      first_family_by_model_id.set(model_id, row.family);
  }
}

export function add_models_dev_models(
  provider: Provider,
  models_dev_provider_name: string,
): Provider {
  const catalog_models = models_dev_catalog[models_dev_provider_name]?.models ?? {};
  const own_models = provider.getModels();
  const own_ids = new Set(own_models.map((model) => model.id));
  const added = Object.values(catalog_models)
    .filter((model) => !own_ids.has(model.id) && agents_can_run_this_model(model))
    .flatMap((model) => {
      const template = find_template(own_models, model);
      return template ? [model_from_models_dev(model, template)] : [];
    });
  const models = [...own_models, ...added].map((model) =>
    catalog_models[model.id]?.temperature === false ? model_sent_no_temperature(model) : model,
  );

  return { ...provider, getModels: () => models };
}

function model_sent_no_temperature(model: Model<Api>): Model<Api> {
  if (model.api !== 'anthropic-messages') return model;
  const anthropic_model = model as Model<'anthropic-messages'>;
  return { ...anthropic_model, compat: { ...anthropic_model.compat, supportsTemperature: false } };
}

function agents_can_run_this_model(model: ModelsDevModel) {
  return (
    model.tool_call === true &&
    model.modalities.output.includes('text') &&
    model.limit.context > 0 &&
    model.status !== 'deprecated'
  );
}

function find_template(own_models: readonly Model<Api>[], model: ModelsDevModel) {
  const family = model_family(model);
  const namespace = model_namespace(model.id);
  const same_family = own_models.filter((candidate) => model_family(candidate) === family);
  const same_namespace = own_models.filter(
    (candidate) => model_namespace(candidate.id) === namespace,
  );
  return (family && same_family.at(-1)) || (namespace && same_namespace.at(-1)) || undefined;
}

function model_from_models_dev(model: ModelsDevModel, template: Model<Api>): Model<Api> {
  return {
    ...template,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning ?? template.reasoning,
    input: model.modalities.input.filter(
      (modality): modality is 'text' | 'image' => modality === 'text' || modality === 'image',
    ),
    cost: {
      input: model.cost?.input ?? template.cost.input,
      output: model.cost?.output ?? template.cost.output,
      cacheRead: model.cost?.cache_read ?? template.cost.cacheRead,
      cacheWrite: model.cost?.cache_write ?? template.cost.cacheWrite,
    },
    contextWindow: model.limit.context,
    maxTokens: model.limit.output ?? template.maxTokens,
  };
}

function model_family(model: { id: string; family?: string | undefined }) {
  return model.family || first_family_by_model_id.get(model.id);
}

function model_namespace(model_id: string) {
  return model_id.includes('/') ? model_id.slice(0, model_id.indexOf('/')) : undefined;
}
