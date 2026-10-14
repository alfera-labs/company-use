import type {
  AutomationTriggerInput,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import {
  read_setup_fields,
  type SetupField,
  validate_setup_value,
} from '@/components/app/automations/trigger_setup_fields';
import { find_trigger_type } from '@/components/app/automations/trigger_types_model';

export function setup_fields_of(
  input: AutomationTriggerInput,
  catalog: TriggerTypeCatalog | undefined,
): SetupField[] {
  if (input.kind !== 'app_event') return [];
  const row = find_trigger_type(catalog, input.node_key)?.row;
  return read_setup_fields(row?.input_schema, row?.setup_fields);
}

export type SetupProblem = { field: SetupField; problem: string };

export function setup_problems_of(
  input: AutomationTriggerInput,
  catalog: TriggerTypeCatalog | undefined,
): SetupProblem[] {
  if (input.kind !== 'app_event') return [];
  const config = input.subscription_config ?? {};
  return setup_fields_of(input, catalog).flatMap((field) => {
    const problem = validate_setup_value(field, config[field.name]);
    return problem ? [{ field, problem }] : [];
  });
}

export function write_setup_value(
  input: AutomationTriggerInput,
  field: SetupField,
  value: string | boolean | undefined,
): AutomationTriggerInput {
  if (input.kind !== 'app_event') return input;
  const config = { ...(input.subscription_config ?? {}) };
  if (value === undefined || value === '') delete config[field.name];
  else config[field.name] = field.type === 'number' ? Number(value) : value;
  return { ...input, subscription_config: config };
}
