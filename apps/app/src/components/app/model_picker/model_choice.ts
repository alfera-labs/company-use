import type { Agent, ModelCatalogEntry } from '@/lib/api';

export type ModelChoice =
  | { choose_model_by: 'let_alfera_recommend' }
  | {
      choose_model_by: 'use_this_exact_model';
      model_provider: string;
      model_proxy: string;
      model_name: string;
    };

export const let_alfera_recommend: ModelChoice = { choose_model_by: 'let_alfera_recommend' };

export function choose_this_model(model: ModelCatalogEntry): ModelChoice {
  return {
    choose_model_by: 'use_this_exact_model',
    model_provider: model.model_provider,
    model_proxy: model.model_proxy,
    model_name: model.model_id,
  };
}

export function is_the_same_choice(left: ModelChoice, right: ModelChoice) {
  if (left.choose_model_by !== right.choose_model_by) return false;
  if (left.choose_model_by === 'let_alfera_recommend') return true;

  return (
    right.choose_model_by === 'use_this_exact_model' &&
    left.model_proxy === right.model_proxy &&
    left.model_name === right.model_name
  );
}

export function find_recommended_model(models: ModelCatalogEntry[]) {
  return models.find((model) => model.is_recommended_for_agent_runs) ?? null;
}

export function find_chosen_model(models: ModelCatalogEntry[], choice: ModelChoice) {
  if (choice.choose_model_by === 'let_alfera_recommend') return null;
  return models.find((model) => is_the_same_choice(choose_this_model(model), choice)) ?? null;
}

export function selected_model_choice(agent: Agent): ModelChoice {
  const pinned = agent.default_model_route;
  if (!pinned) return let_alfera_recommend;

  return { choose_model_by: 'use_this_exact_model', ...pinned };
}

export function written_default_model(choice: ModelChoice) {
  if (choice.choose_model_by === 'let_alfera_recommend') return null;
  return {
    model_provider: choice.model_provider,
    model_proxy: choice.model_proxy,
    model_name: choice.model_name,
  };
}

export function written_message_model(choice: ModelChoice) {
  if (choice.choose_model_by === 'let_alfera_recommend') return {};
  return {
    model_provider: choice.model_provider,
    model_proxy: choice.model_proxy,
    model_name: choice.model_name,
  };
}

export function model_option_key(model: ModelCatalogEntry) {
  return `${model.model_proxy}:${model.model_id}`;
}
