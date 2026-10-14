import type { RuntimeToolResult } from '@coworker/shared';
import { format_error_message } from '@coworker/shared';
import { call_mcp_tool } from '@runtime-platform/tools/mcp/mcp_client';
import {
  build_mcp_authorization_headers,
  type McpCredentialConnection,
} from '@runtime-platform/tools/mcp/mcp_credential_headers';
import { open_mcp_session } from '@runtime-platform/tools/mcp/mcp_session';
import { McpTransportError } from '@runtime-platform/tools/mcp/mcp_transport';

type McpToolInput = {
  node_key: string;
  tool_input: Record<string, unknown>;
  signal?: AbortSignal | undefined;
};

type McpTool = {
  node_id: string;
  app_name: string;
  node_name: string;
  runtime_handler: string;
  node_config: { mcp?: { endpoint_url?: string } | undefined };
  connection_profile_key: string | null;
};

export async function execute_mcp_tool(
  input: McpToolInput,
  tool: McpTool,
  connection: McpCredentialConnection,
): Promise<RuntimeToolResult> {
  const target = read_mcp_call_target(input, tool);
  if (!target.ok) return target.error;

  const headers = build_mcp_authorization_headers(tool, connection);
  if (!headers.ok) return headers.error;

  try {
    const session = await open_mcp_session({
      endpoint_url: target.endpoint_url,
      headers: headers.value,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const result = await call_mcp_tool(session, {
      tool_name: target.tool_name,
      arguments: input.tool_input,
    });

    // MCP reports tool failures in successful JSON-RPC envelopes via isError.
    if (result.isError) {
      return tool_error('mcp_tool_failed', read_result_text(result.content), {
        node_key: input.node_key,
        runtime_handler: tool.runtime_handler,
        connection_id: connection?.connection_id ?? null,
        retryable: false,
      });
    }

    return build_mcp_success_result({ input, tool, connection, session, result });
  } catch (error) {
    return map_mcp_error(error, input, tool, connection);
  }
}

function build_mcp_success_result(parts: {
  input: McpToolInput;
  tool: McpTool;
  connection: McpCredentialConnection;
  session: { identity: { name: string | null }; protocol_version: string };
  result: { structuredContent?: unknown; content: unknown[] };
}): RuntimeToolResult {
  return {
    success: true,
    data: {
      node_key: parts.input.node_key,
      app_name: parts.tool.app_name,
      node_name: parts.tool.node_name,
      output: read_tool_output(parts.result),
    },
    metadata: {
      source: 'mcp',
      runtime_handler: parts.tool.runtime_handler,
      mcp_server: parts.session.identity.name,
      mcp_protocol_version: parts.session.protocol_version,
      node_id: parts.tool.node_id,
      connection_id: parts.connection?.connection_id ?? null,
    },
  };
}

function read_mcp_call_target(
  input: McpToolInput,
  tool: McpTool,
): { ok: true; endpoint_url: string; tool_name: string } | { ok: false; error: RuntimeToolResult } {
  const endpoint_url = tool.node_config?.mcp?.endpoint_url;
  if (!endpoint_url) {
    return {
      ok: false,
      error: tool_error(
        'mcp_endpoint_missing',
        `${input.node_key} has no MCP server address recorded. Re-sync this server's tools.`,
        { node_key: input.node_key, node_id: tool.node_id },
      ),
    };
  }

  const tool_name = read_mcp_tool_name(tool.runtime_handler);
  if (!tool_name) {
    return {
      ok: false,
      error: tool_error('invalid_tool', `${input.node_key} has a malformed MCP runtime handler.`, {
        runtime_handler: tool.runtime_handler,
      }),
    };
  }

  return { ok: true, endpoint_url, tool_name };
}

export function read_mcp_tool_name(runtime_handler: string): string | null {
  const parts = runtime_handler.split('.');
  if (parts.length < 3 || parts[0] !== 'mcp') return null;
  return parts.slice(2).join('.') || null;
}

function read_tool_output(result: { structuredContent?: unknown; content: unknown[] }) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  return { content: result.content };
}

function read_result_text(content: readonly { type: string; text?: string | undefined }[]): string {
  const text = content
    .map((block) => block.text)
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .trim();
  return text || 'The MCP tool reported an error with no message.';
}

function map_mcp_error(
  error: unknown,
  input: McpToolInput,
  tool: McpTool,
  connection: McpCredentialConnection,
): RuntimeToolResult {
  const shared_metadata = {
    node_key: input.node_key,
    runtime_handler: tool.runtime_handler,
    connection_id: connection?.connection_id ?? null,
  };

  if (error instanceof McpTransportError) {
    if (error.kind === 'unauthorized') {
      return tool_error(
        'connection_expired',
        `The ${tool.app_name} connection was refused by the server. Retrying will not help — ` +
          'call runtime-propose_app_sign_in-1 to give the user a reconnect link, then tell them ' +
          'plainly that the connection expired.',
        { ...shared_metadata, retryable: false },
      );
    }
    return tool_error(
      error.kind === 'protocol' ? 'mcp_protocol_error' : 'mcp_unreachable',
      error.message,
      { ...shared_metadata, ...(error.detail ?? {}), retryable: error.kind === 'transport' },
    );
  }

  const message = format_error_message(error);
  return tool_error('mcp_tool_failed', message, shared_metadata);
}

function tool_error(
  code: string,
  message: string,
  metadata?: Record<string, unknown>,
): RuntimeToolResult {
  return {
    success: false,
    error: { code, message },
    ...(metadata ? { metadata } : {}),
  };
}
