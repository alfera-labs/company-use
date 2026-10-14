import type { Database } from '@coworker/core';
import type { ComposioExecuteResult } from '@coworker/core/integrations/composio_api_records';
import {
  composio_provider_key,
  composio_proxy_runtime_handler,
  composio_trigger_runtime_handler_prefix,
} from '@coworker/core/integrations/composio_schema';
import type { RuntimeToolResult } from '@coworker/shared';
import {
  type ComposioClient,
  composio_is_configured,
  get_composio_client,
} from '@runtime-platform/composio/composio_client';
import { read_connected_account_id } from '@runtime-platform/composio/composio_connect';
import { map_composio_error } from '@runtime-platform/composio/composio_errors';
import {
  materialize_composio_file_inputs,
  save_composio_file_outputs,
} from '@runtime-platform/composio/composio_files';
import { execute_composio_proxy } from '@runtime-platform/composio/composio_proxy_execution';
import { is_read_only_composio_action } from '@runtime-platform/composio/composio_read_only_actions';
import type {
  CatalogTool,
  ExecuteCatalogToolInput,
  ToolConnection,
} from '@runtime-platform/tools/catalog_tool_types';
import { find_connection_auth_failure } from '@runtime-platform/tools/connection_auth_failure';
import {
  connection_expired_message,
  record_credential_expiry,
  record_rejected_connection_credential,
} from '@runtime-platform/tools/connection_credential_rejection';

export async function execute_composio_tool(
  db: Database,
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  connection: ToolConnection | null,
): Promise<RuntimeToolResult> {
  if (!composio_is_configured()) {
    return tool_error('composio_not_configured', 'Composio execution requires COMPOSIO_API_KEY.', {
      node_key: input.node_key,
    });
  }

  if (tool.runtime_handler.startsWith(composio_trigger_runtime_handler_prefix)) {
    return tool_error(
      'unsupported_catalog_tool',
      `${input.node_key} is a trigger definition, not an action. A trigger fires on its own once it is enabled for a connection; it cannot be called.`,
      { node_key: input.node_key, runtime_handler: tool.runtime_handler },
    );
  }

  const connection_required = tool.metadata.required_connection !== false;
  if (connection_required && !connection) {
    return tool_error(
      'connection_required',
      `${input.node_key} requires an active ${tool.app_name} connection before execution.`,
      {
        node_key: input.node_key,
        app_name: tool.app_name,
        requested_connection_id: input.connection_id ?? null,
      },
    );
  }

  const connected_account_id = connection ? read_connected_account_id(connection) : null;
  if (connection_required && !connected_account_id) {
    return tool_error(
      'connection_incomplete',
      `${tool.app_display_name} connection is missing a Composio connected account id.`,
      {
        node_key: input.node_key,
        app_name: tool.app_name,
        connection_id: connection?.connection_id ?? input.connection_id ?? null,
      },
    );
  }

  const client = get_composio_client();
  return tool.runtime_handler === composio_proxy_runtime_handler
    ? execute_composio_proxy(db, input, tool, connection, {
        client,
        connected_account_id: connected_account_id ?? '',
      })
    : execute_composio_action(db, input, tool, connection, {
        client,
        connected_account_id,
      });
}

async function execute_composio_action(
  db: Database,
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  connection: ToolConnection | null,
  context: { client: ComposioClient; connected_account_id: string | null },
): Promise<RuntimeToolResult> {
  const tool_slug = read_composio_tool_slug(tool);
  if (!tool_slug) {
    return tool_error('invalid_tool', `${input.node_key} is missing its Composio tool slug.`, {
      node_key: input.node_key,
      runtime_handler: tool.runtime_handler,
    });
  }

  const metadata = {
    source: composio_provider_key,
    runtime_handler: tool.runtime_handler,
    provider_component_id: tool_slug,
    node_id: tool.node_id,
    connection_id: connection?.connection_id ?? null,
  };

  const read_only = is_read_only_composio_action(tool);
  try {
    const prepared = await prepare_composio_action_arguments(input, tool, {
      client: context.client,
      tool_slug,
    });
    if (!prepared.ok) return prepared.error;

    const result = await send_composio_action(input, connection, {
      ...context,
      tool_slug,
      tool_input: prepared.tool_input,
      version: tool.node_config.composio?.pinned_version ?? 'latest',
      repeat_when_unsure: read_only,
    });

    if (!result.successful) {
      return failed_composio_action_result(db, input, tool, connection, {
        provider_error: result.error ?? 'Composio reported the action as unsuccessful.',
        metadata: { ...metadata, log_id: result.log_id ?? null },
      });
    }

    return build_composio_action_success(input, tool, {
      result,
      metadata,
      uploaded_file_count: prepared.uploaded_file_count,
    });
  } catch (error) {
    return record_credential_expiry(
      db,
      { workspace_id: input.workspace_id, actor_id: input.actor_id, connection },
      map_composio_error(error, { call_kind: 'action', metadata, repeats_are_safe: read_only }),
    );
  }
}

function send_composio_action(
  input: ExecuteCatalogToolInput,
  connection: ToolConnection | null,
  request: {
    client: ComposioClient;
    connected_account_id: string | null;
    tool_slug: string;
    tool_input: Record<string, unknown>;
    version: string;
    repeat_when_unsure: boolean;
  },
) {
  return request.client.execute_tool(
    request.tool_slug,
    {
      ...(request.connected_account_id
        ? { connected_account_id: request.connected_account_id }
        : {}),
      user_id: connection?.external_user_key ?? `ws_${input.workspace_id}`,
      arguments: request.tool_input,
      version: request.version,
    },
    {
      ...(input.signal ? { signal: input.signal } : {}),
      repeat_when_unsure: request.repeat_when_unsure,
    },
  );
}

async function prepare_composio_action_arguments(
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  context: { client: ComposioClient; tool_slug: string },
): Promise<
  | { ok: true; tool_input: Record<string, unknown>; uploaded_file_count: number }
  | { ok: false; error: RuntimeToolResult }
> {
  const materialized = await materialize_composio_file_inputs({
    tool_input: input.tool_input,
    tool_schema: tool.input_schema,
    toolkit_slug: read_composio_toolkit_slug(tool),
    tool_slug: context.tool_slug,
    ...(input.environment ? { environment: input.environment } : {}),
    client: context.client,
  });
  if (!materialized.ok) {
    return {
      ok: false,
      error: tool_error(materialized.code, materialized.message, materialized.metadata),
    };
  }
  return {
    ok: true,
    tool_input: materialized.tool_input,
    uploaded_file_count: materialized.uploaded_file_count,
  };
}

async function build_composio_action_success(
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  context: {
    result: ComposioExecuteResult;
    metadata: Record<string, unknown>;
    uploaded_file_count: number;
  },
): Promise<RuntimeToolResult> {
  const output = await save_composio_file_outputs({
    output: context.result.data,
    output_schema: tool.output_schema,
    ...(input.environment ? { environment: input.environment } : {}),
  });

  return {
    success: true,
    data: {
      node_key: input.node_key,
      app_name: tool.app_name,
      node_name: tool.node_name,
      output,
    },
    metadata: {
      ...context.metadata,
      log_id: context.result.log_id ?? null,
      uploaded_file_count: context.uploaded_file_count,
    },
  };
}

async function failed_composio_action_result(
  db: Database,
  input: ExecuteCatalogToolInput,
  tool: CatalogTool,
  connection: ToolConnection | null,
  context: { provider_error: string; metadata: Record<string, unknown> },
): Promise<RuntimeToolResult> {
  const failure = connection ? find_connection_auth_failure(context.provider_error) : null;
  if (connection && failure) {
    await record_rejected_connection_credential(db, {
      workspace_id: input.workspace_id,
      actor_id: input.actor_id,
      connection,
      rejection_detail: failure.matched_text,
    });
    const account = connection.external_account_name ?? connection.connection_name;
    return tool_error('connection_expired', connection_expired_message(account), {
      ...context.metadata,
      node_key: input.node_key,
      app_name: tool.app_name,
      retryable: false,
    });
  }

  return tool_error('provider_action_failed', context.provider_error, {
    ...context.metadata,
    node_key: input.node_key,
    retryable: false,
  });
}

function read_composio_tool_slug(tool: CatalogTool) {
  return (
    tool.node_config.composio?.tool_slug ??
    tool.node_config.sourced_from?.provider_component_id ??
    null
  );
}

function read_composio_toolkit_slug(tool: CatalogTool) {
  const sourced_from = tool.node_config.sourced_from;
  const provider_app_id =
    typeof sourced_from?.provider_app_id === 'string' ? sourced_from.provider_app_id : undefined;
  return tool.node_config.composio?.toolkit_slug ?? provider_app_id ?? tool.app_name;
}

function tool_error(
  code: string,
  message: string,
  metadata?: Record<string, unknown>,
): RuntimeToolResult {
  return {
    success: false,
    error: { code, message },
    ...(metadata ? { metadata } : {}),
  };
}
