const mcp_custom_header_prefix = 'mcp_header:';

export function mcp_header_credential_key(header_name: string) {
  return `${mcp_custom_header_prefix}${header_name}`;
}

export function is_mcp_header_credential_key(key: string) {
  return key.startsWith(mcp_custom_header_prefix);
}

export function read_mcp_header_name(key: string) {
  return key.slice(mcp_custom_header_prefix.length);
}
