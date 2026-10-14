// Streamable HTTP may return JSON-RPC as JSON or SSE; Context7 uses SSE for POST responses.

import {
  type JsonRpcResponse,
  json_rpc_response_schema,
} from '@coworker/core/integrations/mcp_tool_schema';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  find_mcp_request_route,
  type McpRequestRoute,
} from '@runtime-platform/connections/mcp_endpoint_admission';
import {
  type McpAnswer,
  mcp_credential_refusal_words,
  read_mcp_answer,
  words_for_mcp_answer,
  words_for_no_mcp_answer,
} from '@runtime-platform/tools/mcp/mcp_failure_words';
import { build_mcp_request_headers } from '@runtime-platform/tools/mcp/mcp_request_headers';

const log = create_logger('mcp_transport');

const default_timeout_ms = 30_000;

export type McpFailureKind = 'unauthorized' | 'transport' | 'protocol';

export class McpTransportError extends Error {
  constructor(
    readonly kind: McpFailureKind,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpTransportError';
  }
}

export type McpRequestContext = {
  endpoint_url: string;
  headers: Readonly<Record<string, string>>;
  session_id?: string | undefined;
  protocol_version?: string | undefined;
  signal?: AbortSignal | undefined;
  timeout_ms?: number | undefined;
};

export type McpRoundTrip = {
  response: JsonRpcResponse;
  session_id: string | null;
  www_authenticate: string | null;
};

export async function send_mcp_request(
  context: McpRequestContext,
  payload: { id: number; method: string; params?: Record<string, unknown> },
): Promise<McpRoundTrip> {
  const http_response = await post_to_mcp_server(context, {
    jsonrpc: '2.0',
    id: payload.id,
    method: payload.method,
    ...(payload.params ? { params: payload.params } : {}),
  });

  const body = await read_response_body(http_response);
  const parsed = json_rpc_response_schema.safeParse(body);
  if (!parsed.success) {
    throw new McpTransportError(
      'protocol',
      words_for_mcp_answer({ status: http_response.status, content_type: null, body: '' }),
      {
        method: payload.method,
        issues: parsed.error.issues.slice(0, 3),
      },
    );
  }

  return {
    response: parsed.data,
    session_id: http_response.headers.get('mcp-session-id'),
    www_authenticate: http_response.headers.get('www-authenticate'),
  };
}

export async function send_mcp_notification(
  context: McpRequestContext,
  payload: { method: string; params?: Record<string, unknown> },
): Promise<void> {
  await post_to_mcp_server(context, {
    jsonrpc: '2.0',
    method: payload.method,
    ...(payload.params ? { params: payload.params } : {}),
  });
}

async function find_route_or_refuse(endpoint_url: string): Promise<McpRequestRoute> {
  const route = await find_mcp_request_route(endpoint_url);
  if (!('refused' in route)) return route;
  throw new McpTransportError(
    'transport',
    `No request was sent to the MCP server. ${route.refused}`,
    { endpoint_url },
  );
}

async function post_to_mcp_server(
  context: McpRequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const timeout = AbortSignal.timeout(context.timeout_ms ?? default_timeout_ms);
  const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;

  const route = await find_route_or_refuse(context.endpoint_url);
  let response: Response;
  try {
    response = await fetch(route.send_to, {
      method: 'POST',
      headers: build_mcp_request_headers({
        stored_headers: context.headers,
        session_id: context.session_id,
        protocol_version: context.protocol_version,
        host_header: route.host_header,
      }),
      body: JSON.stringify(body),
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    throw new McpTransportError('transport', words_for_no_mcp_answer(error), {
      endpoint_url: context.endpoint_url,
      reason: format_error_message(error),
    });
  }

  await refuse_an_answer_that_is_no_success(response, context.endpoint_url);
  return response;
}

async function refuse_an_answer_that_is_no_success(response: Response, endpoint_url: string) {
  const moved_to = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && moved_to) {
    const target = new URL(moved_to, endpoint_url).toString();
    throw new McpTransportError(
      'transport',
      `The MCP server moved to ${target}. Add the server again with that address.`,
      { status: response.status, moved_to: target },
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new McpTransportError('unauthorized', mcp_credential_refusal_words.stored_credential, {
      status: response.status,
      www_authenticate: response.headers.get('www-authenticate'),
    });
  }
  if (!response.ok) {
    const answer = await read_mcp_answer(response);
    throw new McpTransportError('transport', words_for_mcp_answer(answer), {
      status: response.status,
      body_preview: answer.body.slice(0, 400),
    });
  }
}

async function read_response_body(response: Response): Promise<unknown> {
  const answer = await read_mcp_answer(response);
  const content_type = (answer.content_type ?? '').toLowerCase();
  if (!content_type.startsWith('text/event-stream')) return parse_json_body(answer.body, answer);

  const message = find_last_sse_data_message(answer.body);
  if (message === null) {
    throw new McpTransportError('protocol', 'The MCP server sent an event stream with no message.');
  }
  return parse_json_body(message, answer);
}

function parse_json_body(text: string, answer: McpAnswer): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new McpTransportError('protocol', words_for_mcp_answer(answer), {
      body_preview: text.slice(0, 400),
    });
  }
}

function find_last_sse_data_message(text: string): string | null {
  const frames = text.split(/\r?\n\r?\n/);
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (!frame) continue;
    const data_lines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (data_lines.length === 0) continue;
    return data_lines.join('\n');
  }
  log.warn('MCP event stream contained no data frame', { frame_count: frames.length });
  return null;
}
