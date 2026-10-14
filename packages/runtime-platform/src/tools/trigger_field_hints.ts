import { product_brand_config } from '@coworker/config';
import type { TriggerFieldChoiceSource } from '@coworker/core/db/schema/json_column_types';
import { read_stored_field_choice } from '@runtime-platform/catalog/field_choices/stored_field_choices';

const product_brand_name = product_brand_config.product_brand_name;

type TriggerFieldHint = {
  field: string;
  apps?: readonly string[];
  label?: string;
  description?: string;
  chip_word?: string;
  empty_means?: string;
  unit?: string;
  hidden_at_default?: boolean;
  minimum?: number;
  choices_from?: TriggerFieldChoiceSource;
};

export const trigger_field_hints: readonly TriggerFieldHint[] = [
  {
    field: 'query',
    apps: ['gmail'],
    label: 'Only emails matching',
    description:
      'A Gmail search, like from:billing@example.com or subject:invoice. Leave empty for all mail.',
    chip_word: 'matching',
    empty_means: 'all mail',
  },
  {
    field: 'labelIds',
    apps: ['gmail'],
    label: 'Label',
    description:
      'Only emails with this label. For several, use the search above: label:work OR label:clients.',
    chip_word: 'in',
    choices_from: {
      action_node_name: 'list_labels',
      items_path: ['labels'],
      value_path: ['id'],
      label_path: ['name'],
    },
  },
  {
    field: 'calendarId',
    apps: ['googlecalendar'],
    choices_from: {
      action_node_name: 'list_calendars',
      items_path: ['calendars'],
      value_path: ['id'],
      label_path: ['summary'],
    },
  },
  // Composio polls no faster than once a minute, and none of its interval schemas say so.
  {
    field: 'interval',
    label: 'Check every (minutes)',
    description: `How often ${product_brand_name} looks for new ones. 1 minute or more.`,
    chip_word: 'every',
    unit: 'min',
    minimum: 1,
  },
  { field: 'userId', hidden_at_default: true },
];

export type TriggerFieldWords = {
  chip_word: string | null;
  empty_means: string | null;
  unit: string | null;
  hidden_at_default: boolean;
  choices_from_provider: boolean;
  minimum: number | null;
};

export function find_trigger_field_hint(field: string, provider_app_id: string | null) {
  return trigger_field_hints.find(
    (row) =>
      row.field === field &&
      (row.apps === undefined || (provider_app_id !== null && row.apps.includes(provider_app_id))),
  );
}

export function find_field_choice_source(
  field: string,
  provider_app_id: string | null,
  node_config: unknown,
): TriggerFieldChoiceSource | null {
  return (
    find_trigger_field_hint(field, provider_app_id)?.choices_from ??
    read_stored_field_choice(node_config, field)
  );
}

export function read_trigger_field_words(
  field: string,
  provider_app_id: string | null,
  node_config: unknown = null,
): TriggerFieldWords {
  const hint = find_trigger_field_hint(field, provider_app_id);
  return {
    chip_word: hint?.chip_word ?? null,
    empty_means: hint?.empty_means ?? null,
    unit: hint?.unit ?? null,
    hidden_at_default: hint?.hidden_at_default ?? false,
    choices_from_provider: find_field_choice_source(field, provider_app_id, node_config) !== null,
    minimum: hint?.minimum ?? null,
  };
}
