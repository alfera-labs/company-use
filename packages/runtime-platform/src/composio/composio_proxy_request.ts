// Turning the proxy node's input into Composio's pass-through request. Composio takes one
// `endpoint` plus a flat `parameters` list where each entry says whether it is a header or a query
// parameter, so headers and query parameters are folded into that one list.
//
// The URL rule is the same one every API proxy node enforces: a relative path is always fine (it
// resolves against the toolkit's own base URL), and an absolute URL must be on an origin the app
// row declares. Without that, a proxy node is an open outbound HTTP client with the customer's
// credential attached.

import type { RuntimeToolResult } from '@coworker/shared';
import type { CatalogTool } from '@runtime-platform/tools/catalog_tool_types';
import {
  parse_url,
  url_matches_allowed_request_origin,
} from '@runtime-platform/tools/request_origin_allow_list';

export type ComposioProxyMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export type ComposioProxyRequest = {
  connected_account_id: string;
  endpoint: string;
  method: ComposioProxyMethod;
  body?: unknown;
  parameters?: Array<{ name: string; value: string; type: 'header' | 'query' }>;
};

const composio_proxy_methods: readonly ComposioProxyMethod[] = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
];

export function read_composio_proxy_method(tool: CatalogTool): ComposioProxyMethod | null {
  const method = tool.node_config.proxy?.method?.toUpperCase();
  return composio_proxy_methods.includes(method as ComposioProxyMethod)
    ? (method as ComposioProxyMethod)
    : null;
}

export function build_composio_proxy_request(
  tool_input: Record<string, unknown>,
  tool: CatalogTool,
  context: { method: ComposioProxyMethod; connected_account_id: string },
): { ok: true; request: ComposioProxyRequest } | { ok: false; error: RuntimeToolResult } {
  const endpoint = read_proxy_endpoint(tool_input, tool);
  if (!endpoint.ok) return endpoint;

  const headers = read_string_record(tool_input.headers, 'headers');
  if (!headers.ok) return headers;

  const query_parameters = read_string_record(tool_input.query_parameters, 'query_parameters');
  if (!query_parameters.ok) return query_parameters;

  const parameters = [
    ...to_parameters(headers.value, 'header'),
    ...to_parameters(query_parameters.value, 'query'),
  ];

  return {
    ok: true,
    request: {
      connected_account_id: context.connected_account_id,
      endpoint: endpoint.value,
      method: context.method,
      ...(tool_input.body === undefined ? {} : { body: tool_input.body }),
      ...(parameters.length > 0 ? { parameters } : {}),
    },
  };
}

function read_proxy_endpoint(
  tool_input: Record<string, unknown>,
  tool: CatalogTool,
): { ok: true; value: string } | { ok: false; error: RuntimeToolResult } {
  const url = typeof tool_input.url === 'string' ? tool_input.url.trim() : '';
  if (!url) return invalid_input('url must be a non-empty string.');
  if (url.startsWith('//') || url.includes('\\')) {
    return invalid_input('Relative proxy URLs must be ordinary /path values.');
  }
  if (url.startsWith('/')) return { ok: true, value: url };

  const parsed_url = parse_url(url);
  if (!parsed_url) return invalid_input('url must be a valid absolute URL or relative path.');
  if (!['http:', 'https:'].includes(parsed_url.protocol)) {
    return invalid_input('Absolute proxy URLs must use http or https.');
  }

  const allowed_request_origins = tool.allowed_request_origins;
  if (allowed_request_origins.length === 0) {
    return invalid_input('Absolute proxy URLs require configured allowed origins.');
  }
  if (!url_matches_allowed_request_origin(parsed_url, allowed_request_origins)) {
    return invalid_input(
      `url origin must match an allowed origin: ${allowed_request_origins.join(', ')}.`,
    );
  }

  return { ok: true, value: parsed_url.toString() };
}

function to_parameters(
  values: Record<string, string> | undefined,
  type: 'header' | 'query',
): Array<{ name: string; value: string; type: 'header' | 'query' }> {
  return Object.entries(values ?? {}).map(([name, value]) => ({ name, value, type }));
}

function read_string_record(
  value: unknown,
  field_name: string,
): { ok: true; value?: Record<string, string> } | { ok: false; error: RuntimeToolResult } {
  if (value === undefined) return { ok: true };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid_input(`${field_name} must be an object with string values.`);
  }

  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    if (typeof item === 'object') {
      return invalid_input(`${field_name}.${key} must be a string, number, or boolean.`);
    }
    result[key] = String(item);
  }
  return { ok: true, value: result };
}

function invalid_input(message: string): { ok: false; error: RuntimeToolResult } {
  return {
    ok: false,
    error: {
      success: false,
      error: { code: 'invalid_input', message },
      metadata: { retryable: false },
    },
  };
}
