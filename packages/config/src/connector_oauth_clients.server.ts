import { env } from '@coworker/config/env';

export const connector_oauth_client_env = {
  attio: { client_id: 'CONNECTOR_ATTIO_CLIENT_ID', client_secret: 'CONNECTOR_ATTIO_CLIENT_SECRET' },
  github: {
    client_id: 'CONNECTOR_GITHUB_CLIENT_ID',
    client_secret: 'CONNECTOR_GITHUB_CLIENT_SECRET',
  },
  gmail: { client_id: 'CONNECTOR_GMAIL_CLIENT_ID', client_secret: 'CONNECTOR_GMAIL_CLIENT_SECRET' },
  google_drive: {
    client_id: 'CONNECTOR_GOOGLE_DRIVE_CLIENT_ID',
    client_secret: 'CONNECTOR_GOOGLE_DRIVE_CLIENT_SECRET',
  },
  hubspot: {
    client_id: 'CONNECTOR_HUBSPOT_CLIENT_ID',
    client_secret: 'CONNECTOR_HUBSPOT_CLIENT_SECRET',
  },
  notion: {
    client_id: 'CONNECTOR_NOTION_CLIENT_ID',
    client_secret: 'CONNECTOR_NOTION_CLIENT_SECRET',
  },
  salesforce: {
    client_id: 'CONNECTOR_SALESFORCE_CLIENT_ID',
    client_secret: 'CONNECTOR_SALESFORCE_CLIENT_SECRET',
  },
  slack: { client_id: 'CONNECTOR_SLACK_CLIENT_ID', client_secret: 'CONNECTOR_SLACK_CLIENT_SECRET' },
} as const;

type ConnectorOAuthAppKey = keyof typeof connector_oauth_client_env;

function is_connector_oauth_app_key(app_key: string): app_key is ConnectorOAuthAppKey {
  return Object.hasOwn(connector_oauth_client_env, app_key);
}

export function read_connector_oauth_client(app_key: string) {
  if (!is_connector_oauth_app_key(app_key)) return null;
  const names = connector_oauth_client_env[app_key];
  const client_id = env[names.client_id]?.trim();
  const client_secret = env[names.client_secret]?.trim();
  return client_id && client_secret ? { client_id, client_secret } : null;
}

const configured_env_values: Readonly<Record<string, unknown>> = env;

export function list_unset_env_names(names: readonly string[]): string[] {
  return names.filter((name) => {
    const value = configured_env_values[name];
    return typeof value !== 'string' || value.trim() === '';
  });
}

/**
 * The names with no value in the running process. The OAuth setup reads a client id and secret
 * from here by the name its profile gives, so a check that must agree with it reads here too.
 */
export function list_env_names_with_no_value(names: readonly string[]): string[] {
  return names.filter((name) => !process.env[name]?.trim());
}
