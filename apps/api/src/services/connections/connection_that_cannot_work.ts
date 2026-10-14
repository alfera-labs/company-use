import { is_blocked_host } from '@coworker/core/credentials/safe_outbound_url';
import type { AppMetadataData } from '@coworker/core/db/schema/json_column_types';
import { read_private_mcp_server_rule_for_a_saved_server } from '@runtime-platform/connections/mcp_private_server_rule';

/** What the dashboard shows in place of "Active" for a connection that cannot work now, and why. */
export type ConnectionThatCannotWork = { status_label: string; sentence: string };

type AppWithMetadata = { metadata: AppMetadataData } | null | undefined;
type ConnectionWithApp = { connection_status: string; app: AppWithMetadata };

const servers_on_your_network_are_switched_off: ConnectionThatCannotWork = {
  status_label: 'Switched off',
  sentence:
    'Servers on your own machine or network are switched off on this install. To switch them on again, run ./alfera add local-mcp on the machine that runs Alfera.',
};

/**
 * Why no request goes to the MCP server of an app, or null when one may go: the server is on a
 * private address, and the operator of a self-hosted install switched those off.
 */
export function find_why_no_request_goes_to_mcp_server(
  app: AppWithMetadata,
): ConnectionThatCannotWork | null {
  const server_address = read_mcp_server_address(app?.metadata);
  const is_switched_off =
    server_address !== null &&
    is_blocked_host(server_address.hostname) &&
    read_private_mcp_server_rule_for_a_saved_server() === 'switched_off';
  return is_switched_off ? servers_on_your_network_are_switched_off : null;
}

/**
 * What each reader of a connection adds to the connection it returns: `cannot_work_now`, and
 * only when there is something to say. A connection row alone cannot tell. Two things say that
 * an active connection to an MCP server cannot work: no request goes to the server, or the last
 * time Alfera asked the server for its tools, it failed. The person then reads that failure.
 */
export function say_when_connection_cannot_work(connection: ConnectionWithApp): {
  cannot_work_now?: ConnectionThatCannotWork;
} {
  if (connection.connection_status !== 'active') return {};
  if (!read_mcp_server_address(connection.app?.metadata)) return {};
  const no_request_goes = find_why_no_request_goes_to_mcp_server(connection.app);
  if (no_request_goes) return { cannot_work_now: no_request_goes };

  const last_failure = connection.app?.metadata.mcp_sync?.last_error_message;
  if (!last_failure) return {};
  const sentence = `The last time Alfera asked this server for its tools, it failed. ${last_failure}`;
  return { cannot_work_now: { status_label: 'Not working', sentence } };
}

function read_mcp_server_address(metadata: AppMetadataData | undefined): URL | null {
  const mcp = metadata?.provider_configs?.find((config) => config.provider_key === 'mcp');
  const address = mcp?.setup_defaults?.url;
  return typeof address === 'string' ? URL.parse(address) : null;
}
