import type {
  AutomationTriggerInput,
  TriggerTypeApp,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import type { SetupField } from '@/components/app/automations/trigger_setup_fields';
import { find_trigger_type } from '@/components/app/automations/trigger_types_model';

export function app_has_many_connections(app: TriggerTypeApp | null): boolean {
  return (app?.connections?.length ?? 0) > 1;
}

export function account_name(
  app: TriggerTypeApp | null,
  connection_id: string | undefined,
): string | null {
  const connections = app?.connections ?? [];
  const chosen =
    connections.find((one) => one.connection_id === connection_id) ?? connections[0] ?? null;
  return chosen ? account_words(chosen) : null;
}

export function account_words(connection: {
  connection_name: string;
  account_label: string | null;
}) {
  return connection.account_label ?? connection.connection_name;
}

export function resolved_connection_id(
  app: TriggerTypeApp | null,
  connection_id: string | undefined,
): string | undefined {
  return connection_id ?? app?.connections?.[0]?.connection_id;
}

export function with_account_named(
  input: AutomationTriggerInput,
  catalog: TriggerTypeCatalog | undefined,
): AutomationTriggerInput {
  if (input.kind !== 'app_event') return input;
  const app = find_trigger_type(catalog, input.node_key)?.app ?? null;
  const connection_id = resolved_connection_id(app, input.connection_id);
  return connection_id ? { ...input, connection_id } : input;
}

export function form_connection_id(
  app: TriggerTypeApp | null,
  connection_id: string | undefined,
): string | undefined {
  if (app_has_many_connections(app)) return connection_id;
  return resolved_connection_id(app, connection_id);
}

export function write_connection_id(
  input: AutomationTriggerInput,
  connection_id: string,
  fields: readonly SetupField[],
): AutomationTriggerInput {
  if (input.kind !== 'app_event' || input.connection_id === connection_id) return input;
  const config = { ...(input.subscription_config ?? {}) };
  for (const field of fields) {
    if (field.choices_from_provider) delete config[field.name];
  }
  return { ...input, connection_id, subscription_config: config };
}
