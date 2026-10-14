import { is_mcp_request_header_alfera_sets } from '@coworker/shared';

/**
 * The headers of one request to an MCP server. The headers stored for the server go first, and
 * a stored header whose name Alfera sets itself is dropped whatever its case, so a row saved
 * before that rule cannot change where a request goes or what it claims to be. Some servers
 * refuse a request that omits the SSE media type. `host_header` is the name of a server that is
 * reached by the address that was checked.
 */
export function build_mcp_request_headers(input: {
  stored_headers: Readonly<Record<string, string>>;
  session_id?: string | undefined;
  protocol_version?: string | undefined;
  host_header?: string | null | undefined;
}): Record<string, string> {
  const stored_headers = Object.fromEntries(
    Object.entries(input.stored_headers).filter(
      ([name]) => !is_mcp_request_header_alfera_sets(name),
    ),
  );
  return {
    ...stored_headers,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(input.session_id ? { 'Mcp-Session-Id': input.session_id } : {}),
    ...(input.protocol_version ? { 'MCP-Protocol-Version': input.protocol_version } : {}),
    ...(input.host_header ? { Host: input.host_header } : {}),
  };
}
