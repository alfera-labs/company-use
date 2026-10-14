import type { Database } from '@coworker/core';
import type { DatabaseExecutor } from '@coworker/core/db/connection';
import {
  build_mcp_node_values,
  generate_mcp_app_name,
} from '@coworker/core/integrations/mcp_catalog_node_values';
import {
  type McpToolListing,
  store_mcp_tool_listing,
} from '@runtime-platform/connections/mcp_tool_sync';

const refusal_of_a_tool_list_that_cannot_be_stored =
  'This server lists tools that Alfera cannot tell apart, so it was not added. Each tool of the server needs its own name.';

class McpServerNotStoredError extends Error {}

/**
 * Writes everything one add writes: the server, its connection and its tools. The tool list is
 * built in memory first, so a list that cannot be stored (two tools with one name) is refused
 * with a sentence before the first write. The writes then run in one transaction: whatever
 * fails after the first of them, a key that cannot be encrypted or a row the database refuses,
 * takes all of them back. A failed add leaves no server, no connection and no stored key.
 */
export async function store_added_mcp_server(input: {
  db: Database;
  workspace_id: string;
  actor_id: string;
  server_key: string;
  listing: McpToolListing;
  save_server_and_connection: (db: DatabaseExecutor) => Promise<string>;
}): Promise<{ app_id: string; tool_count: number } | { because: string }> {
  if (!can_build_the_tools(input.listing, input.server_key)) {
    return { because: refusal_of_a_tool_list_that_cannot_be_stored };
  }
  try {
    return await input.db.transaction(async (transaction) => {
      const app_id = await input.save_server_and_connection(transaction);
      const stored = await store_mcp_tool_listing(
        { db: transaction, workspace_id: input.workspace_id, app_id, actor_id: input.actor_id },
        input.listing,
      );
      if (!stored.synced) throw new McpServerNotStoredError(stored.because);
      return { app_id, tool_count: stored.tool_count };
    });
  } catch (error) {
    if (error instanceof McpServerNotStoredError) return { because: error.message };
    throw error;
  }
}

function can_build_the_tools(listing: McpToolListing, server_key: string): boolean {
  try {
    build_mcp_node_values({
      app_name: generate_mcp_app_name(server_key),
      server_key,
      tools: listing.tools,
      trust_tool_annotations: false,
    });
    return true;
  } catch {
    return false;
  }
}
