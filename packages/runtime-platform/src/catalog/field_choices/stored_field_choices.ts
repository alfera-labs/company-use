import type { TriggerFieldChoiceSource } from '@coworker/core/db/schema/json_column_types';
import { z } from 'zod';

const key_schema = z.string().min(1);

export const field_choice_source_schema = z.strictObject({
  action_node_name: z.string().min(1),
  items_path: z.array(key_schema).readonly(),
  value_path: z.array(key_schema).min(1).readonly(),
  label_path: z.array(key_schema).min(1).readonly(),
});

const stored_field_choices_schema = z.strictObject({
  fingerprint: z.string().min(1),
  fields: z.record(z.string(), field_choice_source_schema),
});

export type StoredFieldChoices = z.infer<typeof stored_field_choices_schema>;

const node_config_schema = z.object({ field_choices: z.unknown().optional() });

export function read_stored_field_choices(node_config: unknown): StoredFieldChoices | null {
  const config = node_config_schema.safeParse(node_config ?? {});
  if (!config.success) return null;
  const stored = stored_field_choices_schema.safeParse(config.data.field_choices);
  return stored.success ? stored.data : null;
}

export function read_stored_field_choice(
  node_config: unknown,
  field: string,
): TriggerFieldChoiceSource | null {
  return read_stored_field_choices(node_config)?.fields[field] ?? null;
}
