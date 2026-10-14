import { read_connector_oauth_client } from '@coworker/config/connector_oauth_clients';
import { get_connector_app } from '@coworker/connectors';
import type { Database } from '@coworker/core';
import { save_refreshed_connector_token } from '@coworker/core/db/queries/connectors';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  build_oauth_token_request,
  parse_oauth_token_response,
} from '@runtime-platform/connections/oauth_token_response';

const log = create_logger('connector_token_refresh');

const expiry_margin_ms = 60 * 1000;

export type ConnectorConnectionRow = {
  connection_id: string;
  provider_config_key: string | null;
  credentials: ConnectionCredentialData | null;
  credential_expiry_time: Date | null;
};

export async function renew_expired_connector_access_token<Row extends ConnectorConnectionRow>(
  db: Database,
  connection: Row | null,
  now = new Date(),
): Promise<Row | null> {
  if (!connection || !is_token_expired(connection, now)) return connection;

  const request = build_refresh_request(connection);
  if (!request) return connection;

  try {
    const response = await fetch(request.token_url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    });
    const token_response = await parse_oauth_token_response({ response });
    const saved = await save_refreshed_connector_token(db, {
      connection_id: connection.connection_id,
      existing_credentials: connection.credentials,
      values: {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
      },
      expiry_time: token_response.expires_in
        ? new Date(now.getTime() + token_response.expires_in * 1000)
        : null,
    });
    if (!saved) return connection;
    return {
      ...connection,
      credentials: saved.credentials,
      credential_expiry_time: saved.credential_expiry_time,
    };
  } catch (error) {
    log.warn('connector token refresh failed', {
      connection_id: connection.connection_id,
      error: format_error_message(error),
    });
    return connection;
  }
}

function is_token_expired(connection: ConnectorConnectionRow, now: Date) {
  const expiry_time = connection.credential_expiry_time;
  if (!expiry_time) return false;
  return expiry_time.getTime() - expiry_margin_ms <= now.getTime();
}

function read_connector_app_key(provider_config_key: string | null) {
  const prefix = 'native:';
  if (!provider_config_key?.startsWith(prefix)) return null;
  return provider_config_key.slice(prefix.length) || null;
}

function build_refresh_request(connection: ConnectorConnectionRow) {
  const app_key = read_connector_app_key(connection.provider_config_key);
  const app = app_key ? get_connector_app(app_key) : null;
  const token_url = app?.auth.token_url;
  const refresh_token = read_connection_credential_value(connection.credentials, 'refresh_token');
  const client = app_key ? read_connector_oauth_client(app_key) : null;

  if (!app_key || !token_url || !refresh_token || !client) {
    log.warn('connector token expired with nothing to refresh it from', {
      connection_id: connection.connection_id,
      app_key,
      has_token_url: Boolean(token_url),
      has_refresh_token: Boolean(refresh_token),
      has_client_credentials: Boolean(client),
    });
    return null;
  }

  return {
    token_url,
    ...build_oauth_token_request({
      parameters: { grant_type: 'refresh_token', refresh_token },
      client_id: client.client_id,
      client_secret: client.client_secret,
      token_auth_method: app?.auth.token_auth_method,
      token_request_format: app?.auth.token_request_format,
    }),
  };
}
