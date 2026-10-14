import { createHash } from 'node:crypto';
import {
  decide_whether_to_fetch,
  is_blocked_host,
  type LookupAddresses,
  normalize_hostname,
} from '@coworker/core/credentials/safe_outbound_url';
import {
  judge_private_mcp_server_address,
  type PrivateMcpServerRule,
  type ReadInstallNetworks,
} from '@coworker/core/integrations/mcp_private_server_address';
import { normalize_machine_name } from '@coworker/shared';

/**
 * `checked_address` is there for a server on a private address: the one address the rules were
 * checked against. The request must go to that address, so that a name which answers something
 * else a moment later cannot lead it to another place.
 */
export type McpServerUrlVerdict =
  | { accepted: true; endpoint_url: string; host: string; checked_address?: string }
  | { accepted: false; because: string; lookup_failed?: true };

/**
 * Judges the address a person or the coworker gave for an MCP server. Each refusal is a sentence
 * the person reads under the address field, so it says what to do next. A server on the public
 * internet must be https. A server on a private address is refused unless `private_servers` is
 * `allowed`, which only a self-hosted install can be; plain http is accepted for those alone.
 */
export async function validate_mcp_server_url(input: {
  url: string;
  lookup_addresses: LookupAddresses;
  private_servers?: PrivateMcpServerRule;
  read_install_networks?: ReadInstallNetworks | undefined;
}): Promise<McpServerUrlVerdict> {
  const shape = read_mcp_endpoint_shape(input.url);
  if (!shape.accepted) return shape;
  const accepted = { accepted: true as const, endpoint_url: shape.endpoint_url, host: shape.host };

  if (is_blocked_host(shape.host)) {
    const verdict = await judge_private_mcp_server_address({
      url: shape.parsed,
      rule: input.private_servers ?? 'not_offered',
      lookup_addresses: input.lookup_addresses,
      read_install_networks: input.read_install_networks,
    });
    return verdict.accepted ? { ...accepted, checked_address: verdict.checked_address } : verdict;
  }

  if (shape.parsed.protocol !== 'https:') {
    return {
      accepted: false,
      because: 'The address must start with https://. Use the https address of this server.',
    };
  }
  const verdict = await decide_whether_to_fetch({
    url: shape.endpoint_url,
    allowed_hosts: [shape.host],
    lookup_addresses: input.lookup_addresses,
  });
  if (verdict.may_fetch) return accepted;
  if (verdict.lookup_failed) {
    return {
      accepted: false,
      because: `Alfera could not find ${shape.host}. Check the address for a typing mistake.`,
      lookup_failed: true,
    };
  }
  const next_step =
    input.private_servers === 'allowed'
      ? 'Use the IP address of the server instead.'
      : 'Use an address on the public internet.';
  return {
    accepted: false,
    because: `${shape.host} points to a private address, so Alfera did not use it. ${next_step}`,
  };
}

export async function validate_mcp_chain_url(input: {
  url: string;
  allowed_hosts: readonly string[];
  lookup_addresses: LookupAddresses;
}): Promise<McpServerUrlVerdict> {
  const shape = read_mcp_endpoint_shape(input.url);
  if (!shape.accepted) return shape;

  const verdict = await decide_whether_to_fetch({
    url: shape.endpoint_url,
    allowed_hosts: input.allowed_hosts,
    lookup_addresses: input.lookup_addresses,
  });
  if (!verdict.may_fetch) return { accepted: false, because: verdict.because };
  return { accepted: true, endpoint_url: shape.endpoint_url, host: verdict.host };
}

function read_mcp_endpoint_shape(
  raw_url: string,
):
  | { accepted: true; endpoint_url: string; host: string; parsed: URL }
  | { accepted: false; because: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw_url.trim());
  } catch {
    return {
      accepted: false,
      because:
        'That is not a web address. Paste the full address of the server, for example https://mcp.example.com/mcp.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      accepted: false,
      because: 'The address must start with https://. Use the https address of this server.',
    };
  }
  if (parsed.username || parsed.password) {
    return {
      accepted: false,
      because:
        'Take the username and password out of the address. You give the credential in the next step.',
    };
  }

  parsed.hash = '';
  parsed.hostname = parsed.hostname.replace(/\.$/u, '');
  return {
    accepted: true,
    endpoint_url: parsed.toString(),
    host: normalize_hostname(parsed.hostname),
    parsed,
  };
}

const server_key_max_length = 40;
const address_digest_length = 8;

export function generate_mcp_server_key(endpoint_url: string): string {
  const host = read_host_for_key(endpoint_url);
  const meaningful = list_meaningful_host_labels(host);
  const candidate = meaningful.length > 1 ? meaningful[meaningful.length - 2] : meaningful[0];
  return normalize_server_key(candidate ?? host);
}

/**
 * The keys a server may take, shortest first. A later key is for the case where an earlier one
 * already names a different server in the workspace: two servers of one company share a domain.
 */
export function list_mcp_server_key_candidates(endpoint_url: string): string[] {
  const domain_key = generate_mcp_server_key(endpoint_url);
  const host_labels = list_meaningful_host_labels(read_host_for_key(endpoint_url)).slice(0, -1);
  const host_key =
    host_labels.length > 0 ? normalize_server_key(host_labels.join('_')) : domain_key;
  const digest = createHash('sha256').update(endpoint_url).digest('hex');
  const stem = domain_key.slice(0, server_key_max_length - address_digest_length - 1);
  const address_key = `${stem}_${digest.slice(0, address_digest_length)}`;
  return [...new Set([domain_key, host_key, address_key])];
}

function list_meaningful_host_labels(host: string): string[] {
  const labels = host.split('.').filter((label) => label.length > 0);
  return labels.filter((label) => !generic_host_labels.has(label));
}

function normalize_server_key(value: string): string {
  return normalize_machine_name(value, {
    maximum_length: server_key_max_length,
    fallback: 'mcp_server',
  });
}

const generic_host_labels = new Set(['mcp', 'www', 'api', 'server', 'remote']);

function read_host_for_key(endpoint_url: string): string {
  try {
    return new URL(endpoint_url).hostname.toLowerCase();
  } catch {
    return endpoint_url.toLowerCase();
  }
}
