import type { ConnectorConnection, ConnectorError } from '@coworker/connectors';
import { execute_node } from '@coworker/connectors';
import type {
  ConnectionCredentialData,
  ProviderAccountData,
} from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import type { RuntimeToolResult } from '@coworker/shared';

const connector_runtime_handler_prefix = 'connectors.';

export type ConnectorToolConnection = {
  connection_id: string;
  credentials?: ConnectionCredentialData | null;
  provider_account?: ProviderAccountData;
};

type ConnectorTool = {
  node_id: string;
  app_name: string;
  node_name: string;
  runtime_handler: string;
};

type ConnectorToolInput = {
  node_key: string;
  tool_input: unknown;
  signal?: AbortSignal | undefined;
};

function read_connector_node_key(runtime_handler: string): string | null {
  if (!runtime_handler.startsWith(connector_runtime_handler_prefix)) return null;
  return runtime_handler.slice(connector_runtime_handler_prefix.length) || null;
}

export function is_connector_runtime_handler(runtime_handler: string) {
  return read_connector_node_key(runtime_handler) !== null;
}

const connector_token_credential_keys = ['access_token', 'api_key', 'bot_token'] as const;

export function build_connector_connection(
  connection: ConnectorToolConnection,
): ConnectorConnection | null {
  const access_token = find_connector_access_token(connection);
  if (!access_token) return null;
  const instance_url = connection.provider_account?.instance_url;
  return {
    connection_id: connection.connection_id,
    access_token,
    ...(instance_url ? { instance_url } : {}),
  };
}

function find_connector_access_token(connection: ConnectorToolConnection) {
  for (const key of connector_token_credential_keys) {
    const value = read_connection_credential_value(connection.credentials, key);
    if (value) return value;
  }
  return connection.provider_account?.access_token ?? null;
}

export async function execute_connector_tool(
  input: ConnectorToolInput,
  tool: ConnectorTool,
  connection: ConnectorToolConnection | null,
): Promise<RuntimeToolResult> {
  const node_key = read_connector_node_key(tool.runtime_handler);
  if (!node_key) {
    return connector_tool_error(
      'invalid_tool',
      `${input.node_key} has a malformed connector handler.`,
      {
        runtime_handler: tool.runtime_handler,
      },
    );
  }

  const connector_connection = connection ? build_connector_connection(connection) : null;
  if (!connector_connection) {
    return connector_tool_error(
      'connection_incomplete',
      `${input.node_key} needs an active ${tool.app_name} connection with a saved credential.`,
      {
        node_key: input.node_key,
        app_name: tool.app_name,
        connection_id: connection?.connection_id ?? null,
        retryable: false,
      },
    );
  }

  const result = await execute_node(node_key, input.tool_input, connector_connection, {
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const metadata = {
    source: 'connectors',
    runtime_handler: tool.runtime_handler,
    node_id: tool.node_id,
    connection_id: connector_connection.connection_id,
  };

  if (!result.ok) return connector_failure_result(input, result.error, metadata);
  return {
    success: true,
    data: {
      node_key: input.node_key,
      app_name: tool.app_name,
      node_name: tool.node_name,
      output: result.data,
    },
    metadata,
  };
}

function connector_failure_result(
  input: ConnectorToolInput,
  error: ConnectorError,
  metadata: Record<string, unknown>,
): RuntimeToolResult {
  return {
    success: false,
    error: { code: error.code, message: error.message },
    metadata: { ...metadata, node_key: input.node_key, retryable: error.retryable },
  };
}

function connector_tool_error(
  code: string,
  message: string,
  metadata: Record<string, unknown>,
): RuntimeToolResult {
  return { success: false, error: { code, message }, metadata };
}
