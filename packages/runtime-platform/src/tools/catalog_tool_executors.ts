import type { Database } from '@coworker/core';
import { composio_runtime_handler_prefix } from '@coworker/core/integrations/composio_schema';
import type { RuntimeToolResult } from '@coworker/shared';
import { execute_composio_tool } from '@runtime-platform/composio/composio_executor';
import { renew_expired_connector_access_token } from '@runtime-platform/connections/connector_token_refresh';
import { renew_mcp_access_token } from '@runtime-platform/connections/mcp_token_refresh';
import type {
  CatalogTool,
  ExecuteCatalogToolInput,
  ToolConnection,
} from '@runtime-platform/tools/catalog_tool_types';
import { execute_connector_tool } from '@runtime-platform/tools/connector_executor';
import { execute_mcp_tool } from '@runtime-platform/tools/mcp/mcp_executor';
import { execute_native_slack_tool } from '@runtime-platform/tools/slack/native_executor';

export type CatalogToolExecutor = (
  db: Database,
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  connection: ToolConnection | null,
) => Promise<RuntimeToolResult>;

export const catalog_tool_executors: ReadonlyArray<{
  runtime_handler_prefix: string;
  execute: CatalogToolExecutor;
}> = [
  {
    runtime_handler_prefix: 'mcp.',
    execute: execute_mcp_tool_with_fresh_token,
  },
  {
    runtime_handler_prefix: 'connectors.',
    execute: async (db, input, tool, connection) =>
      execute_connector_tool(
        read_provider_call(input),
        tool,
        await renew_expired_connector_access_token(db, connection),
      ),
  },
  {
    runtime_handler_prefix: 'slack.',
    execute: (db, input, tool, connection) =>
      execute_native_slack_tool({ ...input, db }, tool, connection),
  },
  {
    runtime_handler_prefix: composio_runtime_handler_prefix,
    execute: (db, input, tool, connection) => execute_composio_tool(db, input, tool, connection),
  },
];

export function find_catalog_tool_executor(runtime_handler: string): CatalogToolExecutor | null {
  return (
    catalog_tool_executors.find((entry) => runtime_handler.startsWith(entry.runtime_handler_prefix))
      ?.execute ?? null
  );
}

async function execute_mcp_tool_with_fresh_token(
  db: Database,
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  connection: ToolConnection | null,
): Promise<RuntimeToolResult> {
  const call = read_provider_call(input);
  const fresh = await renew_mcp_access_token(db, connection);
  const result = await execute_mcp_tool(call, tool, fresh);
  if (result.success || result.error.code !== 'connection_expired') return result;
  const renewed = await renew_mcp_access_token(db, fresh, { after_refusal: true });
  return renewed === fresh ? result : execute_mcp_tool(call, tool, renewed);
}

function read_provider_call(input: ExecuteCatalogToolInput) {
  return {
    node_key: input.node_key,
    tool_input: input.tool_input,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}
