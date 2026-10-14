import type { ModelChoice } from '@/components/app/model_picker/model_choice';
import { find_inherited_model } from '@/components/app/model_picker/model_presets';
import type { ModelCatalogEntry } from '@/lib/api';

/** Names the model a chat uses when its model picker says Auto: the default model of the agent. */
export function describe_auto_model(models: ModelCatalogEntry[], default_choice: ModelChoice) {
  const model = find_inherited_model(models, default_choice);
  return model ? `A chat set to Auto uses ${model.model_display_name}.` : undefined;
}

export function AutoModelNote({
  models,
  defaultChoice,
}: {
  models: ModelCatalogEntry[];
  defaultChoice: ModelChoice;
}) {
  const sentence = describe_auto_model(models, defaultChoice);
  if (!sentence) return null;
  return <p className="mt-2 text-muted-foreground text-xs">{sentence}</p>;
}
