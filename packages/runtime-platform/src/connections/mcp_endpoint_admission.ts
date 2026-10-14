import { isIP } from 'node:net';
import { resolve_host_addresses } from '@coworker/core/credentials/resolve_host_addresses';
import { validate_mcp_server_url } from '@coworker/core/integrations/mcp_server_url';
import { create_logger, format_error_message } from '@coworker/shared';
import { read_install_networks } from '@runtime-platform/connections/mcp_install_networks';
import {
  type McpServerAsker,
  read_private_mcp_server_rule,
  read_private_mcp_server_rule_for_a_saved_server,
} from '@runtime-platform/connections/mcp_private_server_rule';

import { build_mcp_request_headers } from '@runtime-platform/tools/mcp/mcp_request_headers';

const log = create_logger('mcp_endpoint_admission');

const redirect_statuses = new Set([301, 302, 307, 308]);
const redirect_probe_timeout_ms = 10_000;

/**
 * Validates an MCP server address and settles it on the address the server answers on. A server
 * that redirects to its own site (most often a missing trailing slash) is saved at the redirected
 * address, because its OAuth tokens are issued for that exact address. A redirect to another site
 * is never followed. A private address is admitted only for an owner or admin in the dashboard
 * of a self-hosted install whose operator opened them; whoever does not say who asks is the
 * coworker.
 */
export async function admit_mcp_server_url(input: {
  server_url: string;
  headers?: Record<string, string>;
  asked_by?: McpServerAsker | undefined;
}) {
  const rules = {
    lookup_addresses: resolve_host_addresses,
    private_servers: read_private_mcp_server_rule(input.asked_by ?? 'coworker'),
    read_install_networks,
  };
  const admitted = await validate_mcp_server_url({ url: input.server_url, ...rules });
  if (!admitted.accepted) return admitted;
  const settled_url = await follow_same_site_redirect(
    admitted.endpoint_url,
    input.headers,
    build_mcp_request_route(admitted.endpoint_url, admitted.checked_address),
  );
  if (settled_url === admitted.endpoint_url) return admitted;
  return validate_mcp_server_url({ url: settled_url, ...rules });
}

/** Where one request goes, and the `Host` header it carries when that is not the name in the address. */
export type McpRequestRoute = { send_to: string; host_header: string | null };

/**
 * A request to a server on a private address goes to the address that was checked, with the
 * name of the server in the `Host` header. The request then cannot look the name up a second
 * time and get another answer. Every other request goes to the address as it is written.
 */
export function build_mcp_request_route(
  endpoint_url: string,
  checked_address: string | undefined,
): McpRequestRoute {
  if (!checked_address) return { send_to: endpoint_url, host_header: null };
  const url = new URL(endpoint_url);
  const host_header = url.host;
  url.hostname = isIP(checked_address) === 6 ? `[${checked_address}]` : checked_address;
  return { send_to: url.toString(), host_header };
}

/**
 * Where a request to a saved MCP server address goes now, or why none may go. The address was
 * judged when it was saved, and is judged again before each request, because a name can point
 * somewhere else by then. A public name that cannot be looked up at this moment is left to the
 * request, which then fails by itself. A private name that cannot be looked up gets no request.
 */
export async function find_mcp_request_route(
  endpoint_url: string,
): Promise<McpRequestRoute | { refused: string }> {
  const verdict = await validate_mcp_server_url({
    url: endpoint_url,
    lookup_addresses: resolve_host_addresses,
    private_servers: read_private_mcp_server_rule_for_a_saved_server(),
    read_install_networks,
  });
  if (verdict.accepted)
    return build_mcp_request_route(verdict.endpoint_url, verdict.checked_address);
  if (verdict.lookup_failed) return build_mcp_request_route(endpoint_url, undefined);
  return { refused: verdict.because };
}

export async function follow_same_site_redirect(
  endpoint_url: string,
  headers: Record<string, string> = {},
  route: McpRequestRoute = build_mcp_request_route(endpoint_url, undefined),
): Promise<string> {
  const response = await fetch(route.send_to, {
    method: 'POST',
    headers: build_mcp_request_headers({ stored_headers: headers, host_header: route.host_header }),
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
    redirect: 'manual',
    signal: AbortSignal.timeout(redirect_probe_timeout_ms),
  }).catch((error) => {
    log.info('The MCP server did not answer the redirect check; keeping the address as typed.', {
      endpoint_url,
      error: format_error_message(error),
    });
    return null;
  });
  const location = response?.headers.get('location');
  if (!response || !redirect_statuses.has(response.status) || !location) return endpoint_url;
  const target = new URL(location, endpoint_url);
  return target.origin === new URL(endpoint_url).origin ? target.toString() : endpoint_url;
}

/** The headers the connection itself will send, so no request reaches the server without them. */
export function headers_for_the_server(input: {
  access_token?: string | undefined;
  request_headers?: Record<string, string> | undefined;
}) {
  const access_token = input.access_token?.trim();
  return {
    ...(input.request_headers ?? {}),
    ...(access_token ? { Authorization: `Bearer ${access_token}` } : {}),
  };
}
