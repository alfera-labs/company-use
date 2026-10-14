import type { IntegrationApp } from '@/lib/api/types';

const slack_icon_url = '/logos/slack.svg';

const catalog_app_aliases_by_key: Record<string, readonly string[]> = {
  ads: ['googleads', 'metaads'],
  attio: ['attio'],
  apollo: ['apollo'],
  clay: ['clay'],
  gmail: ['gmail', 'googlemail'],
  googleads: ['googleads', 'adwords'],
  googleanalytics: ['googleanalytics', 'ga4', 'analytics'],
  googledrive: ['googledrive', 'drive'],
  googlesheets: ['googlesheets', 'sheets', 'spreadsheet'],
  hubspot: ['hubspot'],
  instantly: ['instantly'],
  linear: ['linear'],
  metaads: ['metaads', 'facebookads'],
  notion: ['notion'],
  quickbooks: ['quickbooks'],
  slack: ['slack'],
  stripe: ['stripe'],
};

export type ConnectionProfile = {
  provider_key?: string;
  provider_config_key?: string;
  connection_profile_key?: string;
};

type AppCatalogMetadata = {
  icon_url?: string;
  description?: string;
  provider_configs?: Array<{
    provider_key?: string;
    provider_config_key?: string;
    status: string;
    connection_profiles: Array<{ connection_profile_key?: string; status: string }>;
  }>;
};

function app_catalog_fields(app: IntegrationApp) {
  return {
    metadata: app.metadata as AppCatalogMetadata,
    display_config: app.display_config as Pick<AppCatalogMetadata, 'icon_url' | 'description'>,
  };
}

export function app_icon_url(app: IntegrationApp): string | undefined {
  const fields = app_catalog_fields(app);
  return (
    fields.metadata.icon_url ??
    fields.display_config.icon_url ??
    fallback_app_icon_url(app) ??
    undefined
  );
}

export function app_description(app: IntegrationApp): string | null {
  const fields = app_catalog_fields(app);
  return fields.metadata.description ?? fields.display_config.description ?? null;
}

export function app_key(app: IntegrationApp) {
  return app.app_name;
}

export function app_matches_alias(app: IntegrationApp, alias: string) {
  const app_keys = [app.app_name, app.app_display_name].map(normalize_app_key).filter(Boolean);
  const alias_keys = app_alias_keys(alias);
  return app_keys.some((key) => alias_keys.includes(key));
}

export function app_alias_keys(alias: string) {
  const alias_key = normalize_app_key(alias);
  return [alias_key, ...(catalog_app_aliases_by_key[alias_key] ?? [])].map(normalize_app_key);
}

export function normalize_app_key(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fallback_app_icon_url(app: IntegrationApp) {
  return app_matches_alias(app, 'slack') ? slack_icon_url : null;
}

export function first_connection_profile(app: IntegrationApp): ConnectionProfile | null {
  return pick_connection_profile(app_catalog_fields(app).metadata.provider_configs ?? []);
}

export function brain_connection_profile(
  app: IntegrationApp,
  provider_key: string,
): ConnectionProfile | null {
  const provider_configs = app_catalog_fields(app).metadata.provider_configs ?? [];
  return pick_connection_profile(
    provider_configs.filter((config) => config.provider_key === provider_key),
  );
}

function pick_connection_profile(
  provider_configs: NonNullable<AppCatalogMetadata['provider_configs']>,
): ConnectionProfile | null {
  for (const config of provider_configs) {
    if (config.status !== 'active') continue;
    const profile = config.connection_profiles.find((candidate) => candidate.status === 'active');
    if (!profile) continue;

    const provider_key = config.provider_key;
    const provider_config_key = config.provider_config_key;
    const connection_profile_key = profile.connection_profile_key;

    return {
      ...(provider_key ? { provider_key } : {}),
      ...(provider_config_key ? { provider_config_key } : {}),
      ...(connection_profile_key ? { connection_profile_key } : {}),
    };
  }

  return null;
}
