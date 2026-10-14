import type { Database } from '@coworker/core';
import { resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import type { RuntimeToolResult } from '@coworker/shared';
import { find_catalog_tool_executor } from '@runtime-platform/tools/catalog_tool_executors';
import type { RuntimeCatalogToolInput } from '@runtime-platform/tools/types';

type PersonToolInput = {
  workspace_id: string;
  user_id: string;
  node_key: string;
  connection_id: string;
  tool_input: RuntimeCatalogToolInput;
};

type Resolved = Awaited<ReturnType<typeof resolve_catalog_tool>>;

export async function execute_catalog_tool_for_person(
  db: Database,
  input: PersonToolInput,
): Promise<RuntimeToolResult> {
  const resolved = await resolve_catalog_tool(db, {
    workspace_id: input.workspace_id,
    node_key: input.node_key,
    connection_id: input.connection_id,
    participants: { project: [], user: [input.user_id], agent: [] },
    room_private_to: input.user_id,
  });
  const refusal = read_refusal(resolved, input.node_key);
  if (refusal || !resolved.tool) return refusal ?? missing_node(input.node_key);
  const execute = find_catalog_tool_executor(resolved.tool.runtime_handler);
  if (!execute) {
    return tool_error('unsupported_catalog_tool', `${input.node_key} has no runtime.`, {
      runtime_handler: resolved.tool.runtime_handler,
    });
  }
  const run_as_person = {
    workspace_id: input.workspace_id,
    session_id: `person:${input.user_id}`,
    run_id: `person:${input.user_id}`,
    actor_id: input.user_id,
    acting_actor_id: input.user_id,
    node_key: input.node_key,
    connection_id: input.connection_id,
    tool_input: input.tool_input,
  };
  return execute(db, run_as_person, resolved.tool, resolved.connection);
}

function read_refusal(resolved: Resolved, node_key: string): RuntimeToolResult | null {
  if (!resolved.tool) return missing_node(node_key);
  if (resolved.access_denied) {
    return tool_error('access_denied', 'That connection is private to somebody else.', {
      node_key,
    });
  }
  if (!resolved.compatibility.ok) {
    return tool_error(resolved.compatibility.reason, 'That connection cannot run this action.', {
      node_key,
    });
  }
  return null;
}

function missing_node(node_key: string) {
  return tool_error('node_missing', `${node_key} is not in the catalog.`, { node_key });
}

function tool_error(
  code: string,
  message: string,
  metadata?: Record<string, unknown>,
): RuntimeToolResult {
  return { success: false, error: { code, message }, ...(metadata ? { metadata } : {}) };
}
