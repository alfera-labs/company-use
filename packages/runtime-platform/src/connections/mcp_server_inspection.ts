import { resolve_host_addresses } from '@coworker/core/credentials/resolve_host_addresses';
import { discover_mcp_authorization } from '@coworker/core/integrations/mcp_authorization_discovery';
import { probe_mcp_authorization } from '@runtime-platform/connections/mcp_authorization_probe';
import { admit_mcp_server_url } from '@runtime-platform/connections/mcp_endpoint_admission';
import type { McpServerAsker } from '@runtime-platform/connections/mcp_private_server_rule';
import { mcp_credential_refusal_words } from '@runtime-platform/tools/mcp/mcp_failure_words';
import { McpTransportError } from '@runtime-platform/tools/mcp/mcp_transport';

export type McpAuthenticationMode = 'always' | 'when_asked' | 'none';

/**
 * What a server said when it was asked. `offers_sign_in` is true only when its OAuth documents
 * can be read: a server that asks for a credential and publishes none takes a key or a token,
 * and the dialog must not say that a sign-in was detected.
 */
export type McpServerInspection =
  | {
      inspected: true;
      endpoint_url: string;
      server_name: string | null;
      icon_url: string | null;
      description: string | null;
      authentication: McpAuthenticationMode;
      offers_sign_in: boolean;
      supports_dynamic_registration: boolean;
    }
  | { inspected: false; because: string };

export async function inspect_mcp_server(input: {
  server_url: string;
  asked_by?: McpServerAsker | undefined;
}): Promise<McpServerInspection> {
  const admitted = await admit_mcp_server_url(input);
  if (!admitted.accepted) return { inspected: false, because: admitted.because };

  const challenge = await probe_mcp_authorization(admitted.endpoint_url).catch(refuse_unreachable);
  if ('because' in challenge) return { inspected: false, because: challenge.because };
  const identity = challenge.identity;
  const server = {
    inspected: true as const,
    endpoint_url: admitted.endpoint_url,
    server_name: identity?.name ?? null,
    icon_url: identity?.icon_url ?? null,
    description: identity?.description ?? null,
  };

  if (challenge.kind === 'open') {
    return {
      ...server,
      authentication: 'none',
      offers_sign_in: false,
      supports_dynamic_registration: false,
    };
  }

  return {
    ...server,
    authentication: challenge.when,
    ...(await read_sign_in_offer({
      endpoint_url: admitted.endpoint_url,
      www_authenticate: challenge.www_authenticate,
    })),
  };
}

async function read_sign_in_offer(input: {
  endpoint_url: string;
  www_authenticate: string | null;
}): Promise<{ offers_sign_in: boolean; supports_dynamic_registration: boolean }> {
  try {
    const authorization = await discover_mcp_authorization({
      endpoint_url: input.endpoint_url,
      www_authenticate: input.www_authenticate,
      lookup_addresses: resolve_host_addresses,
    });
    return {
      offers_sign_in: true,
      supports_dynamic_registration: Boolean(authorization.registration_endpoint),
    };
  } catch {
    return { offers_sign_in: false, supports_dynamic_registration: false };
  }
}

/** A server that cannot be reached is a refusal the person can act on, not a server error. */
export function refuse_unreachable(error: unknown): { because: string } {
  if (error instanceof McpTransportError) return { because: error.message };
  throw error;
}

/**
 * The same, for an add that sent a credential or none: a server that refuses it gets the
 * sentence for what the person gave, which says what to change in the dialog.
 */
export function refuse_credential_or_unreachable(
  given: keyof typeof mcp_credential_refusal_words,
): (error: unknown) => { because: string } {
  return (error) => {
    if (error instanceof McpTransportError && error.kind === 'unauthorized') {
      return { because: mcp_credential_refusal_words[given] };
    }
    return refuse_unreachable(error);
  };
}
