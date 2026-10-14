import type { ConnectorErrorCode, ConnectorResult } from '@coworker/connectors';
import type { Database } from '@coworker/core';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import type { RuntimeToolResult } from '@coworker/shared';
import { find_provider_rate_limit } from '@runtime-platform/composio/sync/provider_rate_limit';
import { find_catalog_tool_executor } from '@runtime-platform/tools/catalog_tool_executors';
import type { ToolConnection } from '@runtime-platform/tools/catalog_tool_types';
import { z } from 'zod';

export type SyncNodeRunner = (
  node_key: string,
  node_input: unknown,
) => Promise<ConnectorResult<unknown>>;

type SyncNodeCall = {
  workspace_id: string;
  connection: ToolConnection;
  node_key: string;
  node_input: unknown;
};

const sync_actor_id = 'system:memory_sync';
const runnable_node_statuses = ['active', 'deprecated'];
const catalog_tool_output_schema = z.object({ output: z.unknown() });
const node_input_schema = z.record(z.string(), z.unknown());
const failure_metadata_schema = z.object({
  composio_status: z.number().optional(),
  upstream_status: z.number().optional(),
  retry_after_seconds: z.number().optional(),
});

const connector_error_code_by_tool_error_code: Readonly<Record<string, ConnectorErrorCode>> = {
  node_missing: 'unknown_node',
  unsupported_catalog_tool: 'unknown_node',
  invalid_tool: 'unknown_node',
  credential_expired: 'unauthorized',
  connection_expired: 'unauthorized',
  connection_required: 'unauthorized',
  connection_incomplete: 'unauthorized',
  rate_limited: 'rate_limited',
  provider_unreachable: 'network_error',
};

const retryable_connector_error_codes: ReadonlySet<ConnectorErrorCode> = new Set([
  'rate_limited',
  'network_error',
]);

function unknown_node(node_key: string, reason: string): ConnectorResult<unknown> {
  return {
    ok: false,
    error: { code: 'unknown_node', message: `${node_key} ${reason}`, retryable: false },
  };
}

function to_connector_result(result: RuntimeToolResult): ConnectorResult<unknown> {
  if (result.success) {
    const envelope = catalog_tool_output_schema.safeParse(result.data);
    if (envelope.success) return { ok: true, data: envelope.data.output };
    return {
      ok: false,
      error: {
        code: 'invalid_output',
        message: 'The catalog node answered without an output field.',
        retryable: false,
      },
    };
  }
  const metadata = failure_metadata_schema.safeParse(result.metadata ?? {});
  const failure = metadata.success ? metadata.data : {};
  const rate_limit = find_provider_rate_limit({
    error_code: result.error.code,
    message: result.error.message,
    status: failure.composio_status ?? failure.upstream_status ?? null,
    retry_after_seconds: failure.retry_after_seconds ?? null,
    now: new Date(),
  });
  if (rate_limit) {
    return {
      ok: false,
      error: {
        code: 'rate_limited',
        message: result.error.message,
        retryable: true,
        retry_after_seconds: rate_limit.retry_after_seconds,
      },
    };
  }
  const code = connector_error_code_by_tool_error_code[result.error.code] ?? 'provider_error';
  const retryable =
    result.metadata?.retryable === true || retryable_connector_error_codes.has(code);
  return { ok: false, error: { code, message: result.error.message, retryable } };
}

async function run_catalog_node_for_sync(
  db: Database,
  call: SyncNodeCall,
): Promise<ConnectorResult<unknown>> {
  const tool = await get_tool_catalog_entry(db, {
    node_key: call.node_key,
    workspace_id: call.workspace_id,
    node_statuses: runnable_node_statuses,
  });
  if (!tool) return unknown_node(call.node_key, 'is not an active node in the catalog.');
  const execute = find_catalog_tool_executor(tool.runtime_handler);
  if (!execute) return unknown_node(call.node_key, `has no runtime for ${tool.runtime_handler}.`);
  const tool_input = node_input_schema.safeParse(call.node_input ?? {});
  if (!tool_input.success) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: `${call.node_key} needs an object input.`,
        retryable: false,
      },
    };
  }
  const result = await execute(
    db,
    {
      workspace_id: call.workspace_id,
      session_id: sync_actor_id,
      run_id: sync_actor_id,
      actor_id: sync_actor_id,
      node_key: call.node_key,
      connection_id: call.connection.connection_id,
      tool_input: tool_input.data,
    },
    tool,
    call.connection,
  );
  return to_connector_result(result);
}

export function create_catalog_sync_node_runner(
  db: Database,
  input: {
    workspace_id: string;
    connection: ToolConnection;
    app_name: string | null;
    on_call_made?: (() => void) | undefined;
  },
): SyncNodeRunner {
  const { workspace_id, connection, app_name, on_call_made } = input;
  return (node_key, node_input) => {
    on_call_made?.();
    return run_catalog_node_for_sync(db, {
      workspace_id,
      connection,
      node_key: node_key_for_app(node_key, app_name),
      node_input,
    });
  };
}

export function node_key_for_app(node_key: string, app_name: string | null) {
  if (!app_name) return node_key;
  const action_and_version = node_key.slice(node_key.indexOf('-') + 1);
  return `${app_name}-${action_and_version}`;
}
