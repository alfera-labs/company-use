import { is_credential_shaped_header_name } from '@coworker/core/credentials/credential_shaped_header';
import type {
  AppConfigData,
  AppDisplayConfigData,
  AppMetadataData,
  ConnectionConfigData,
  ConnectionSetupStateData,
  ProviderAccountData,
} from '@coworker/core/db/schema/json_column_types';

type ConnectionRow = {
  connection_id: string;
  workspace_id: string;
  app_id: string;
  connection_name: string | null;
  connection_status: string;
  connection_key?: string | null;
  provider_key?: string | null;
  provider_config_key?: string | null;
  provider_config_version?: number | null;
  connection_profile_key?: string | null;
  connection_profile_version?: number | null;
  auth_method_key?: string | null;
  external_user_key?: string | null;
  external_account_id: string | null;
  external_account_name: string | null;
  authorized_scopes?: string[];
  health_status?: string | null;
  connected_by?: string | null;
  connected_time?: Date | null;
  last_checked_time?: Date | null;
  last_provider_update_time?: Date | null;
  revoked_time?: Date | null;
  connection_config?: ConnectionConfigData;
  setup_state?: ConnectionSetupStateData;
  provider_account?: ProviderAccountData;
  credential_expiry_time: Date | null;
  metadata: unknown;
  created_time: Date;
  last_updated_time: Date;
  created_by: string;
  last_updated_by: string;
};

type ConnectionAppRow = {
  app_id: string;
  app_name: string;
  app_key: string;
  app_display_name: string;
  app_category?: string | null;
  auth_type: string;
  display_config: AppDisplayConfigData;
  allowed_request_origins?: readonly string[];
  app_config?: AppConfigData;
  metadata: AppMetadataData;
};

export function redact_connection(connection: ConnectionRow) {
  return {
    connection_id: connection.connection_id,
    workspace_id: connection.workspace_id,
    app_id: connection.app_id,
    connection_key: connection.connection_key ?? null,
    connection_name: connection.connection_name,
    connection_status: connection.connection_status,
    provider_key: connection.provider_key ?? null,
    provider_config_key: connection.provider_config_key ?? null,
    provider_config_version: connection.provider_config_version ?? null,
    connection_profile_key: connection.connection_profile_key ?? null,
    connection_profile_version: connection.connection_profile_version ?? null,
    auth_method_key: connection.auth_method_key ?? null,
    external_user_key: connection.external_user_key ?? null,
    external_account_id: connection.external_account_id,
    external_account_name: connection.external_account_name,
    authorized_scopes: connection.authorized_scopes ?? [],
    health_status: connection.health_status ?? null,
    connected_by: connection.connected_by ?? null,
    connected_time: connection.connected_time ?? null,
    last_checked_time: connection.last_checked_time ?? null,
    last_provider_update_time: connection.last_provider_update_time ?? null,
    revoked_time: connection.revoked_time ?? null,
    connection_config: connection.connection_config ?? {},
    setup_state: redact_setup_state(connection.setup_state),
    provider_account: redact_provider_account(connection.provider_account),
    credential_expiry_time: connection.credential_expiry_time,
    metadata: connection.metadata,
    created_time: connection.created_time,
    last_updated_time: connection.last_updated_time,
    created_by: connection.created_by,
    last_updated_by: connection.last_updated_by,
  };
}

export function redact_connection_with_app(
  connection: ConnectionRow,
  app: ConnectionAppRow | null | undefined,
) {
  return {
    ...redact_connection(connection),
    app: app ? redact_connection_app(app) : null,
  };
}

export type RedactedConnection = ReturnType<typeof redact_connection>;

function redact_connection_app(app: ConnectionAppRow) {
  return {
    app_id: app.app_id,
    app_name: app.app_name,
    app_key: app.app_key,
    app_display_name: app.app_display_name,
    app_category: app.app_category ?? null,
    auth_type: app.auth_type,
    display_config: app.display_config,
    allowed_request_origins: app.allowed_request_origins ?? [],
    authenticated_request_hosts: read_authenticated_request_hosts(app.app_config),
    api_protocol_headers: read_api_protocol_headers(app.app_config),
    metadata: app.metadata,
  };
}

function read_authenticated_request_hosts(app_config: AppConfigData | undefined): string[] {
  const hosts = (app_config?.add_to_every_request ?? []).map(
    (rule) => rule.when_the_request_goes_to,
  );
  return [...new Set(hosts)];
}

function read_api_protocol_headers(app_config: AppConfigData | undefined): Record<string, string> {
  const headers = app_config?.api_protocol_headers ?? {};
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && !is_credential_shaped_header_name(entry[0]),
    ),
  );
}

function redact_provider_account(record: ProviderAccountData | undefined) {
  return Object.fromEntries(
    Object.entries(record ?? {}).map(([key, account_value]) => [
      key,
      is_sensitive_key(key) ? '[redacted]' : account_value,
    ]),
  );
}

function redact_setup_state(record: ConnectionSetupStateData | undefined) {
  return Object.fromEntries(
    Object.entries(record ?? {}).map(([key, setup_value]) => [
      key,
      is_sensitive_key(key) ? '[redacted]' : setup_value,
    ]),
  );
}

function is_sensitive_key(key: string) {
  const normalized_key = key.toLowerCase();
  return (
    normalized_key.includes('token') ||
    normalized_key.includes('secret') ||
    normalized_key.includes('password') ||
    normalized_key.includes('credential') ||
    normalized_key.includes('verifier')
  );
}
