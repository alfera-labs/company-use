import { Brain, Eye, FileText, Wrench } from 'lucide-react';
import { find_chosen_model, type ModelChoice } from '@/components/app/model_picker/model_choice';
import { list_resolved_model_presets } from '@/components/app/model_picker/model_presets';
import type { ModelCatalogEntry } from '@/lib/api';

export function describe_model_choice(
  models: ModelCatalogEntry[],
  choice: ModelChoice,
  inherited_model: ModelCatalogEntry | null,
  inherited_choice: ModelChoice = { choose_model_by: 'let_alfera_recommend' },
) {
  const chosen_model = find_chosen_model(models, choice);
  if (chosen_model) return chosen_model.model_display_name;
  if (choice.choose_model_by === 'use_this_exact_model') {
    return `${choice.model_name} (Unavailable)`;
  }
  if (inherited_choice.choose_model_by === 'use_this_exact_model' && inherited_model === null) {
    return `Agent default (${inherited_choice.model_name} unavailable)`;
  }

  const [inherit_preset] = list_resolved_model_presets(models, inherited_model, inherited_choice);
  if (!inherit_preset) return 'Recommended';

  return `${inherit_preset.label} (${inherit_preset.model.model_display_name})`;
}

export function describe_model_choice_briefly(models: ModelCatalogEntry[], choice: ModelChoice) {
  const chosen_model = find_chosen_model(models, choice);
  if (chosen_model) return chosen_model.model_display_name;
  if (choice.choose_model_by === 'use_this_exact_model') {
    return `${choice.model_name} (Unavailable)`;
  }
  return 'Auto';
}

export function format_context_window(context_window: number) {
  if (context_window >= 1_000_000) return `${trim_decimal(context_window / 1_000_000)}M`;
  return `${Math.round(context_window / 1_000)}K`;
}

export function describe_context_window(context_window: number) {
  const words = (context_window * 0.75) / 1_000;
  const rounded_words = words >= 100 ? Math.round(words / 50) * 50 : Math.round(words);

  return `${format_context_window(context_window)} tokens, roughly ${rounded_words}k words`;
}

export const model_capabilities = [
  {
    label: 'Tools',
    icon_label: 'Tool calling',
    Icon: Wrench,
    is_supported: (model: ModelCatalogEntry) => model.supports_tool_calls,
  },
  {
    label: 'Images',
    icon_label: 'Image input',
    Icon: Eye,
    is_supported: (model: ModelCatalogEntry) => model.input_modalities.includes('image'),
  },
  {
    label: 'PDFs',
    icon_label: 'PDF input',
    Icon: FileText,
    is_supported: (model: ModelCatalogEntry) => model.input_modalities.includes('pdf'),
  },
  {
    label: 'Thinking',
    icon_label: 'Step-by-step reasoning',
    Icon: Brain,
    is_supported: (model: ModelCatalogEntry) => model.supports_reasoning,
  },
];

export function searchable_model_text(model: ModelCatalogEntry) {
  return `${model.model_display_name} ${model.model_provider_display_name} ${model.model_family ?? ''}`;
}

function trim_decimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, '');
}
