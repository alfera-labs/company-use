// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import {
  type SetupFieldChipProps,
  TriggerChipButton,
} from '@/components/app/automations/trigger_chip_button';
import { chip_value_for } from '@/components/app/automations/trigger_chip_words';
import type { TriggerFieldChoice } from '@/components/app/automations/trigger_field_choices_api';
import { use_trigger_field_choices } from '@/components/app/automations/use_trigger_field_choices';

export function ProviderChoiceChip({
  field,
  value,
  node_key,
  connection_id,
  onOpen,
}: SetupFieldChipProps) {
  const choices_query = use_trigger_field_choices(node_key, field.name, connection_id);
  const shown = provider_choice_label(field, value, choices_query);
  return <TriggerChipButton field={field} shown={shown} value={value} onOpen={onOpen} />;
}

function provider_choice_label(
  field: SetupFieldChipProps['field'],
  value: SetupFieldChipProps['value'],
  choices_query: { data: TriggerFieldChoice[] | undefined; isLoading: boolean },
): string {
  if (typeof value !== 'string' || !value) return chip_value_for(field, value);
  if (choices_query.isLoading) return '…';
  return choices_query.data?.find((choice) => choice.value === value)?.label ?? value;
}
