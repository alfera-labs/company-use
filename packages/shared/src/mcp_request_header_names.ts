/**
 * The headers of a request to an MCP server that Alfera sets itself. A header a person adds to
 * a server must not carry one of these names: `Host` says which server answers, and the others
 * are the protocol. Names are compared without regard to case.
 */
export const mcp_request_header_names_alfera_sets = [
  'host',
  'content-type',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
] as const;

export function is_mcp_request_header_alfera_sets(name: string): boolean {
  const lower_case_name = name.trim().toLowerCase();
  return mcp_request_header_names_alfera_sets.some((reserved) => reserved === lower_case_name);
}

/** The sentence a person reads for the first header name Alfera sets itself, or null. */
export function find_mcp_request_header_refusal(names: readonly string[]): string | null {
  const reserved = names.map((name) => name.trim()).find(is_mcp_request_header_alfera_sets);
  if (reserved === undefined) return null;
  return `Alfera sets the ${reserved} header itself. Take it out of the additional request headers.`;
}
