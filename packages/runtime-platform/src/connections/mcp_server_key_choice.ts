import type { Database } from '@coworker/core';
import {
  find_workspace_mcp_app_by_endpoint_url,
  list_taken_mcp_server_keys,
} from '@coworker/core/db/queries/mcp_catalog';
import { list_mcp_server_key_candidates } from '@coworker/core/integrations/mcp_server_url';

type AddedMcpApp = NonNullable<Awaited<ReturnType<typeof find_workspace_mcp_app_by_endpoint_url>>>;

/**
 * A server is the address it answers on. A server the workspace already added keeps its key;
 * a new one takes the shortest key that no other server in the workspace holds.
 */
export async function pick_mcp_server_key(
  db: Database,
  workspace_id: string,
  endpoint_url: string,
): Promise<string> {
  const already_added = await find_workspace_mcp_app_by_endpoint_url(db, {
    workspace_id,
    endpoint_url,
  });
  if (already_added) return read_mcp_server_key(already_added);

  const candidates = list_mcp_server_key_candidates(endpoint_url);
  const taken = await list_taken_mcp_server_keys(db, { workspace_id, server_keys: candidates });
  const free_key = candidates.find((server_key) => !taken.includes(server_key));
  if (!free_key) throw new Error(`No free MCP server key is left for ${endpoint_url}.`);
  return free_key;
}

function read_mcp_server_key(app: AddedMcpApp): string {
  const config = app.metadata.provider_configs?.find((entry) => entry.provider_key === 'mcp');
  if (!config?.provider_app_key) {
    throw new Error(`MCP app ${app.app_id} has no server key in its provider config.`);
  }
  return config.provider_app_key;
}
