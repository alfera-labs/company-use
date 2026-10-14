import type {
  AppMetadataData,
  AppProviderConfigData,
  ConnectionProfileData,
} from '@coworker/core/db/schema/json_column_types';
import { ValidationError } from '@coworker/shared';

export type ConnectionProfile = ConnectionProfileData;
export type AppProviderConfig = AppProviderConfigData;

export function parse_app_provider_configs(metadata: AppMetadataData): AppProviderConfig[] {
  const provider_configs = metadata.provider_configs ?? [];

  assert_unique_records(
    provider_configs,
    (config) => `${config.provider_config_key}:${config.version}`,
    'provider_config_key + version',
  );

  for (const config of provider_configs) {
    assert_unique_records(
      config.connection_profiles,
      (profile) => `${profile.connection_profile_key}:${profile.version}`,
      'connection_profile_key + version',
    );
  }

  return provider_configs;
}

export function find_active_provider_config(
  configs: AppProviderConfig[],
  input: { provider_key?: string | undefined; provider_config_key?: string | undefined },
) {
  return (
    configs.find(
      (config) =>
        config.status === 'active' &&
        (input.provider_key === undefined || config.provider_key === input.provider_key) &&
        (input.provider_config_key === undefined ||
          config.provider_config_key === input.provider_config_key),
    ) ?? null
  );
}

export function find_active_connection_profile(
  config: AppProviderConfig,
  input: { connection_profile_key?: string | undefined },
) {
  return (
    config.connection_profiles.find(
      (profile) =>
        profile.status === 'active' &&
        (input.connection_profile_key === undefined ||
          profile.connection_profile_key === input.connection_profile_key),
    ) ?? null
  );
}

function assert_unique_records<T>(records: T[], build_key: (record: T) => string, label: string) {
  const seen_keys = new Set<string>();
  for (const record of records) {
    const key = build_key(record);
    if (seen_keys.has(key)) {
      throw new ValidationError(`Duplicate ${label} in app provider configs`, { duplicate: key });
    }
    seen_keys.add(key);
  }
}
