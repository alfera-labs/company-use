import type { McpServerIdentity } from '@coworker/core/integrations/mcp_tool_schema';
import { open_mcp_session } from '@runtime-platform/tools/mcp/mcp_session';
import { McpTransportError } from '@runtime-platform/tools/mcp/mcp_transport';

export type McpAuthorizationChallenge =
  | { kind: 'open'; identity: McpServerIdentity }
  | {
      kind: 'needs_authorization';
      when: 'always' | 'when_asked';
      www_authenticate: string | null;
      identity: McpServerIdentity | null;
    };

// Context7 may return authorization metadata with a successful anonymous session.
// Either that offer or an authorization refusal starts setup.
export async function probe_mcp_authorization(
  endpoint_url: string,
): Promise<McpAuthorizationChallenge> {
  try {
    const session = await open_mcp_session({ endpoint_url });
    if (session.authorization_offer) {
      return {
        kind: 'needs_authorization',
        when: 'when_asked',
        www_authenticate: session.authorization_offer,
        identity: session.identity,
      };
    }
    return { kind: 'open', identity: session.identity };
  } catch (error) {
    if (error instanceof McpTransportError && error.kind === 'unauthorized') {
      const header = error.detail?.www_authenticate;
      return {
        kind: 'needs_authorization',
        when: 'always',
        www_authenticate: typeof header === 'string' ? header : null,
        identity: null,
      };
    }
    throw error;
  }
}
