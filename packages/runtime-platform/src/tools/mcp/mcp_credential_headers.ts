import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import {
  read_connection_credential_value,
  read_connection_credential_values,
} from '@coworker/core/integrations/credential_envelope';
import {
  is_mcp_header_credential_key,
  read_mcp_header_name,
} from '@coworker/core/integrations/mcp_credential_keys';
import type { RuntimeToolResult } from '@coworker/shared';

const credential_value_keys = ['access_token', 'api_key', 'token', 'bearer_token'] as const;

export type McpCredentialSource = {
  app_name: string;
  connection_profile_key: string | null;
};

export type McpCredentialConnection = {
  connection_id: string;
  credentials: Record<string, unknown> | null;
  auth_method_key?: string | null;
} | null;

export type McpHeadersResult =
  | { ok: true; value: Record<string, string> }
  | { ok: false; error: RuntimeToolResult };

export function build_mcp_authorization_headers(
  tool: McpCredentialSource,
  connection: McpCredentialConnection,
): McpHeadersResult {
  if (!tool.connection_profile_key) return { ok: true, value: {} };

  if (!connection) {
    return build_credential_failure(
      'connection_required',
      `${tool.app_name} needs an active connection before its tools can run.`,
      { app_name: tool.app_name },
    );
  }

  const headers = read_mcp_request_headers(connection.credentials);

  if (connection.auth_method_key === 'none') return { ok: true, value: headers };

  if (!headers.Authorization) {
    return build_credential_failure(
      'connection_incomplete',
      `The ${tool.app_name} connection has no usable credential stored.`,
      { connection_id: connection.connection_id },
    );
  }

  return { ok: true, value: headers };
}

export function read_mcp_request_headers(
  credentials: Record<string, unknown> | null,
): Record<string, string> {
  if (!credentials) return {};
  return { ...read_mcp_bearer_header(credentials), ...read_mcp_custom_headers(credentials) };
}

function read_mcp_bearer_header(
  credentials: Record<string, unknown> | null,
): Record<string, string> {
  if (!credentials) return {};
  for (const key of credential_value_keys) {
    const value = read_connection_credential_value(credentials, key);
    if (value) return { Authorization: `Bearer ${value}` };
  }
  return {};
}

function read_mcp_custom_headers(credentials: Record<string, unknown> | null) {
  const values = read_connection_credential_values(credentials as ConnectionCredentialData | null);
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => is_mcp_header_credential_key(key))
      .map(([key, value]) => [read_mcp_header_name(key), value]),
  );
}

function build_credential_failure(
  code: string,
  message: string,
  metadata: Record<string, unknown>,
): McpHeadersResult {
  return { ok: false, error: { success: false, error: { code, message }, metadata } };
}
