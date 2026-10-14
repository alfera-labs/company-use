import type { Database } from '@coworker/core';
import { composio_provider_key } from '@coworker/core/integrations/composio_schema';
import type { RuntimeToolResult } from '@coworker/shared';
import type { ComposioClient } from '@runtime-platform/composio/composio_client';
import { map_composio_error } from '@runtime-platform/composio/composio_errors';
import {
  build_composio_proxy_request,
  read_composio_proxy_method,
} from '@runtime-platform/composio/composio_proxy_request';
import { repeats_are_safe_for_http_method } from '@runtime-platform/composio/composio_request_retry';
import type {
  CatalogTool,
  ExecuteCatalogToolInput,
  ToolConnection,
} from '@runtime-platform/tools/catalog_tool_types';
import { record_credential_expiry } from '@runtime-platform/tools/connection_credential_rejection';

/** Runs a Composio API proxy node; only GET and HEAD are repeated after an unsure failure. */
export async function execute_composio_proxy(
  db: Database,
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  connection: ToolConnection | null,
  context: { client: ComposioClient; connected_account_id: string },
): Promise<RuntimeToolResult> {
  const prepared = prepare_proxy_call(input, tool, connection, context.connected_account_id);
  if (!prepared.ok) return prepared.error;
  const { request, metadata } = prepared;

  try {
    const response = await context.client.proxy_execute(request, {
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      success: true,
      data: {
        node_key: input.node_key,
        app_name: tool.app_name,
        node_name: tool.node_name,
        output: response.data ?? null,
      },
      metadata: { ...metadata, upstream_status: response.status },
    };
  } catch (error) {
    return record_credential_expiry(
      db,
      { workspace_id: input.workspace_id, actor_id: input.actor_id, connection },
      map_composio_error(error, {
        call_kind: 'proxy',
        metadata,
        repeats_are_safe: repeats_are_safe_for_http_method(request.method),
      }),
    );
  }
}

function prepare_proxy_call(
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  connection: ToolConnection | null,
  connected_account_id: string,
) {
  const method = read_composio_proxy_method(tool);
  if (!method) {
    const message = `${input.node_key} is missing a valid proxy method.`;
    const metadata = { node_key: input.node_key, runtime_handler: tool.runtime_handler };
    const error: RuntimeToolResult = {
      success: false,
      error: { code: 'invalid_tool', message },
      metadata: { ...metadata, node_config: tool.node_config },
    };
    return { ok: false as const, error };
  }

  const proxy_request = build_composio_proxy_request(input.tool_input, tool, {
    method,
    connected_account_id,
  });
  if (!proxy_request.ok) return proxy_request;

  const metadata = {
    source: composio_provider_key,
    runtime_handler: tool.runtime_handler,
    proxy_method: method,
    proxy_endpoint: proxy_request.request.endpoint,
    node_id: tool.node_id,
    connection_id: connection?.connection_id ?? null,
  };
  return { ok: true as const, request: proxy_request.request, metadata };
}
