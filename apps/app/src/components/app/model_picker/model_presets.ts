import {
  choose_this_model,
  find_chosen_model,
  find_recommended_model,
  let_alfera_recommend,
  type ModelChoice,
} from '@/components/app/model_picker/model_choice';
import type { ModelCatalogEntry } from '@/lib/api';

export type ResolvedModelPreset = {
  preset_name: string;
  label: string;
  description: string;
  option_key: string;
  model: ModelCatalogEntry;
  choice: ModelChoice;
};

type ModelPreset = {
  preset_name: string;
  read_label: (input: PresetInput) => string;
  read_description: (input: PresetInput) => string;
  find_model: (input: PresetInput) => ModelCatalogEntry | null;
  decide_choice: (model: ModelCatalogEntry) => ModelChoice;
};

type PresetInput = {
  models: ModelCatalogEntry[];
  inherited_model: ModelCatalogEntry | null;
  inherited_choice: ModelChoice;
};

const model_presets: ModelPreset[] = [
  {
    preset_name: 'inherit',
    read_label: (input) =>
      input.inherited_model || input.inherited_choice.choose_model_by === 'use_this_exact_model'
        ? 'Agent default'
        : 'Recommended',
    read_description: (input) =>
      input.inherited_model
        ? 'Use whatever this agent is set to'
        : 'Best balance of speed, quality, and cost',
    find_model: (input) =>
      input.inherited_choice.choose_model_by === 'use_this_exact_model'
        ? input.inherited_model
        : (input.inherited_model ?? find_recommended_model(input.models)),
    decide_choice: () => let_alfera_recommend,
  },
  {
    preset_name: 'smartest',
    read_label: () => 'Smartest',
    read_description: () => 'Maximum intelligence for complex tasks',
    find_model: (input) =>
      find_best_rated_model(input.models, 'intelligence_out_of_five', 'speed_out_of_five'),
    decide_choice: choose_this_model,
  },
  {
    preset_name: 'fastest',
    read_label: () => 'Fastest',
    read_description: () => 'Optimized for speed and low latency',
    find_model: (input) =>
      find_best_rated_model(input.models, 'speed_out_of_five', 'intelligence_out_of_five'),
    decide_choice: choose_this_model,
  },
];

export function list_resolved_model_presets(
  models: ModelCatalogEntry[],
  inherited_model: ModelCatalogEntry | null = null,
  inherited_choice: ModelChoice = let_alfera_recommend,
): ResolvedModelPreset[] {
  const input = { models, inherited_model, inherited_choice };

  return model_presets.flatMap((preset) => {
    const model = preset.find_model(input);
    if (!model) return [];

    return [
      {
        preset_name: preset.preset_name,
        label: preset.read_label(input),
        description: preset.read_description(input),
        option_key: `preset:${preset.preset_name}`,
        model,
        choice: preset.decide_choice(model),
      },
    ];
  });
}

export function find_inherited_model(models: ModelCatalogEntry[], inherited_choice: ModelChoice) {
  if (inherited_choice.choose_model_by === 'use_this_exact_model') {
    return find_chosen_model(models, inherited_choice);
  }
  return find_recommended_model(models);
}

export function searchable_preset_text(preset: ResolvedModelPreset) {
  return `${preset.label} ${preset.description} ${preset.model.model_display_name}`;
}

function find_best_rated_model(
  models: ModelCatalogEntry[],
  rank_by: 'speed_out_of_five' | 'intelligence_out_of_five',
  tie_break_by: 'speed_out_of_five' | 'intelligence_out_of_five',
) {
  const rated = models.filter((model) => model[rank_by] !== null && model[tie_break_by] !== null);

  return rated.reduce<ModelCatalogEntry | null>((best, model) => {
    if (!best) return model;
    const difference =
      (model[rank_by] ?? 0) - (best[rank_by] ?? 0) ||
      (model[tie_break_by] ?? 0) - (best[tie_break_by] ?? 0) ||
      (model.release_date ?? '').localeCompare(best.release_date ?? '') ||
      best.model_display_name.localeCompare(model.model_display_name);

    return difference > 0 ? model : best;
  }, null);
}
