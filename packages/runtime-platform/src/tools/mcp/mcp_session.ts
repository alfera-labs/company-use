import {
  type JsonRpcResponse,
  type McpServerIdentity,
  mcp_initialize_result_schema,
  normalize_mcp_server_identity,
} from '@coworker/core/integrations/mcp_tool_schema';
import { create_logger } from '@coworker/shared';
import {
  type McpRequestContext,
  McpTransportError,
  send_mcp_notification,
  send_mcp_request,
} from '@runtime-platform/tools/mcp/mcp_transport';

const log = create_logger('mcp_session');

const preferred_protocol_version = '2025-06-18';
const supported_protocol_versions = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

export type McpSession = {
  endpoint_url: string;
  headers: Readonly<Record<string, string>>;
  session_id: string | undefined;
  protocol_version: string;
  identity: McpServerIdentity;
  authorization_offer: string | null;
  signal?: AbortSignal | undefined;
};

export type McpConnectionInput = {
  endpoint_url: string;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal | undefined;
};

export async function open_mcp_session(input: McpConnectionInput): Promise<McpSession> {
  const context: McpRequestContext = {
    endpoint_url: input.endpoint_url,
    headers: input.headers ?? {},
    ...(input.signal ? { signal: input.signal } : {}),
  };

  const { response, session_id, www_authenticate } = await send_mcp_request(context, {
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: preferred_protocol_version,
      capabilities: {},
      clientInfo: { name: 'alfera', version: '1' },
    },
  });

  const initialized = read_initialize_result(response);

  const session: McpSession = {
    endpoint_url: input.endpoint_url,
    headers: input.headers ?? {},
    session_id: session_id ?? undefined,
    protocol_version: initialized.protocolVersion,
    identity: normalize_mcp_server_identity(initialized.serverInfo),
    authorization_offer: www_authenticate,
    ...(input.signal ? { signal: input.signal } : {}),
  };

  await send_mcp_notification(build_request_context(session), {
    method: 'notifications/initialized',
  });
  return session;
}

function read_initialize_result(response: JsonRpcResponse) {
  const result = read_json_rpc_result(response, 'initialize');
  const initialized = mcp_initialize_result_schema.safeParse(result);
  if (!initialized.success) {
    throw new McpTransportError(
      'protocol',
      'The MCP server sent an unreadable initialize result.',
      {
        issues: initialized.error.issues.slice(0, 3),
      },
    );
  }
  if (!supported_protocol_versions.has(initialized.data.protocolVersion)) {
    throw new McpTransportError(
      'protocol',
      `The MCP server speaks protocol ${initialized.data.protocolVersion}, which Alfera does not support.`,
      { negotiated_version: initialized.data.protocolVersion },
    );
  }
  return initialized.data;
}

export function build_request_context(session: McpSession): McpRequestContext {
  return {
    endpoint_url: session.endpoint_url,
    headers: session.headers,
    session_id: session.session_id,
    protocol_version: session.protocol_version,
    signal: session.signal,
  };
}

export function read_json_rpc_result(response: JsonRpcResponse, what: string): unknown {
  if (response.error) {
    log.warn('MCP server returned a JSON-RPC error', {
      what,
      code: response.error.code,
      message: response.error.message,
    });
    throw new McpTransportError('protocol', `${what} was refused: ${response.error.message}`, {
      json_rpc_code: response.error.code,
    });
  }
  if (response.result === undefined) {
    throw new McpTransportError('protocol', `${what} returned neither a result nor an error.`);
  }
  return response.result;
}
