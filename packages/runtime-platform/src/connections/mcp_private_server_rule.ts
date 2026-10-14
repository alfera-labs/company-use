import { read_private_mcp_server_setting } from '@coworker/config/workspace_runtime_env';
import type { PrivateMcpServerRule } from '@coworker/core/integrations/mcp_private_server_address';

/** Who gives the address of an MCP server: an owner or admin in the dashboard, or the coworker in a chat. */
export type McpServerAsker = 'administrator_in_dashboard' | 'coworker';

const rule_by_setting = {
  not_self_hosted: { administrator_in_dashboard: 'not_offered', coworker: 'not_offered' },
  closed: { administrator_in_dashboard: 'switched_off', coworker: 'switched_off' },
  open: { administrator_in_dashboard: 'allowed', coworker: 'dashboard_only' },
} as const satisfies Record<
  ReturnType<typeof read_private_mcp_server_setting>,
  Record<McpServerAsker, PrivateMcpServerRule>
>;

export function read_private_mcp_server_rule(asked_by: McpServerAsker): PrivateMcpServerRule {
  return rule_by_setting[read_private_mcp_server_setting()][asked_by];
}

/**
 * The rule for a request to a server that is already saved. Only an owner or admin could save a
 * private address, so the operator's switch alone decides here: once it is off, a saved private
 * server gets no request.
 */
export function read_private_mcp_server_rule_for_a_saved_server(): PrivateMcpServerRule {
  return read_private_mcp_server_rule('administrator_in_dashboard');
}
