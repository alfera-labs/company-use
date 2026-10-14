import type { LookupAddresses } from '@coworker/core/credentials/safe_outbound_url';
import { validate_mcp_chain_url } from '@coworker/core/integrations/mcp_server_url';
import { format_error_message, ValidationError } from '@coworker/shared';
import { z } from 'zod';

const metadata_fetch_timeout_ms = 15_000;

const protected_resource_metadata_schema = z
  .object({
    resource: z.string().optional(),
    authorization_servers: z.array(z.string().min(1)).default([]),
  })
  .loose();

const authorization_server_metadata_schema = z
  .object({
    issuer: z.string().optional(),
    authorization_endpoint: z.string().min(1),
    token_endpoint: z.string().min(1),
    registration_endpoint: z.string().min(1).optional(),
    code_challenge_methods_supported: z.array(z.string()).default([]),
    grant_types_supported: z.array(z.string()).default([]),
    scopes_supported: z.array(z.string()).default([]),
    token_endpoint_auth_methods_supported: z.array(z.string()).default([]),
  })
  .loose();

export type McpAuthorizationServer = {
  authorization_endpoint: string;
  token_endpoint: string;
  // Absent means the server has no dynamic client registration and a client id
  // must come from configuration. GitHub is the live example.
  registration_endpoint: string | null;
  scopes_supported: string[];
  supports_public_client: boolean;
  resource: string;
};

const resource_metadata_parameter = /(?:^|[,\s])resource_metadata="([^"]+)"/iu;

export function read_resource_metadata_url(www_authenticate: string | null): string | null {
  if (!www_authenticate) return null;
  return resource_metadata_parameter.exec(www_authenticate)?.[1] ?? null;
}

export async function discover_mcp_authorization(input: {
  endpoint_url: string;
  www_authenticate: string | null;
  lookup_addresses: LookupAddresses;
}): Promise<McpAuthorizationServer> {
  const endpoint_host = read_host(input.endpoint_url);
  const metadata_url =
    read_resource_metadata_url(input.www_authenticate) ??
    generate_protected_resource_url(input.endpoint_url);

  const protected_resource = await read_protected_resource_metadata(
    metadata_url,
    endpoint_host,
    input.lookup_addresses,
  );

  // SEP-985: a server publishing no protected-resource document is its own
  // authorization server. Refusing those rejects working URLs.
  const issuer = protected_resource?.authorization_servers[0] ?? new URL(input.endpoint_url).origin;

  const allowed_hosts = [endpoint_host, read_host(issuer)];
  const metadata = await get_authorization_server_metadata(
    issuer,
    allowed_hosts,
    input.lookup_addresses,
  );

  assert_supports_pkce(metadata.code_challenge_methods_supported, issuer);
  await assert_endpoints_are_allowed(metadata, allowed_hosts, input.lookup_addresses);

  return {
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    registration_endpoint: metadata.registration_endpoint ?? null,
    scopes_supported: metadata.scopes_supported,
    supports_public_client: metadata.token_endpoint_auth_methods_supported.includes('none'),
    resource: protected_resource?.resource ?? input.endpoint_url,
  };
}

async function read_protected_resource_metadata(
  metadata_url: string,
  endpoint_host: string,
  lookup_addresses: LookupAddresses,
) {
  try {
    const document = await get_guarded_json(metadata_url, [endpoint_host], lookup_addresses);
    return protected_resource_metadata_schema.parse(document);
  } catch {
    return null;
  }
}

// S256 or nothing. Notion, Sentry and Asana all advertise `plain` alongside
// S256, and `plain` sends the verifier in the clear — taking the server's first
// offer would silently drop the protection PKCE exists to provide.
function assert_supports_pkce(methods: readonly string[], issuer: string) {
  if (methods.includes('S256')) return;
  throw new ValidationError(
    'This authorization server does not support PKCE S256, which Alfera requires.',
    { issuer, code_challenge_methods_supported: methods },
  );
}

async function assert_endpoints_are_allowed(
  metadata: { authorization_endpoint: string; token_endpoint: string },
  allowed_hosts: readonly string[],
  lookup_addresses: LookupAddresses,
) {
  const endpoints = [
    ['authorization endpoint', metadata.authorization_endpoint],
    ['token endpoint', metadata.token_endpoint],
  ] as const;
  for (const [name, url] of endpoints) {
    const verdict = await validate_mcp_chain_url({ url, allowed_hosts, lookup_addresses });
    if (!verdict.accepted) {
      throw new ValidationError(`Refused to use the ${name} ${url}: ${verdict.because}`, {
        allowed_hosts: [...allowed_hosts],
      });
    }
  }
}

async function get_authorization_server_metadata(
  issuer: string,
  allowed_hosts: readonly string[],
  lookup_addresses: LookupAddresses,
) {
  const failures: string[] = [];
  for (const candidate of generate_metadata_urls(issuer)) {
    try {
      const document = await get_guarded_json(candidate, allowed_hosts, lookup_addresses);
      return authorization_server_metadata_schema.parse(document);
    } catch (error) {
      failures.push(`${candidate}: ${format_error_message(error)}`);
    }
  }
  throw new ValidationError('Could not read the authorization server metadata.', {
    issuer,
    attempts: failures,
  });
}

// Two specs disagree about where this document lives and real servers split
// across both: Stripe publishes only the RFC 8414 form, GitHub only the OpenID
// form, Linear both. Try all four rather than pick a side.
export function generate_metadata_urls(issuer: string): string[] {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/$/, '');
  const origin = url.origin;
  if (!path) {
    return [
      `${origin}/.well-known/oauth-authorization-server`,
      `${origin}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}/.well-known/openid-configuration${path}`,
    `${origin}${path}/.well-known/oauth-authorization-server`,
    `${origin}${path}/.well-known/openid-configuration`,
  ];
}

function generate_protected_resource_url(endpoint_url: string): string {
  const url = new URL(endpoint_url);
  const path = url.pathname.replace(/\/$/, '');
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

async function get_guarded_json(
  url: string,
  allowed_hosts: readonly string[],
  lookup_addresses: LookupAddresses,
): Promise<unknown> {
  const verdict = await validate_mcp_chain_url({ url, allowed_hosts, lookup_addresses });
  if (!verdict.accepted) {
    throw new ValidationError(`Refused to fetch ${url}: ${verdict.because}`);
  }

  const response = await fetch(verdict.endpoint_url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(metadata_fetch_timeout_ms),
  });
  if (!response.ok) throw new ValidationError(`HTTP ${response.status}`);
  return response.json();
}

function read_host(value: string): string {
  return new URL(value).hostname.toLowerCase();
}
