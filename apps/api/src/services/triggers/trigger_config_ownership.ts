import type { TriggerConfigData } from '@coworker/core/db/schema/json_column_types';

const server_owned_keys = [
  'provisioned_by',
  'provisioning_key',
  'event_source',
  'starts_job_handler',
  'webhook_secret',
  'webhook_secret_hash',
] as const;

const wire_keys = ['provisioned_by', 'provisioning_key', 'event_source'] as const;

export function drop_server_owned_config_keys<T extends Record<string, unknown>>(config: T) {
  return without(config, server_owned_keys) as T;
}

export function drop_wire_config_keys<T extends Record<string, unknown>>(config: T) {
  return without(config, wire_keys) as T;
}

export function keep_server_owned_config_keys(
  current: TriggerConfigData,
  next: TriggerConfigData,
): TriggerConfigData {
  const kept = Object.fromEntries(
    server_owned_keys.filter((key) => current[key] !== undefined).map((key) => [key, current[key]]),
  );
  return { ...without(next, server_owned_keys), ...kept };
}

function without(config: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !keys.includes(key)));
}
