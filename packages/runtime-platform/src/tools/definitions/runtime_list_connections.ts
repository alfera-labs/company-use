import {
  type ConnectionSnapshotItem,
  list_connection_snapshot,
} from '@runtime-platform/connections/connection_snapshot';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  app_name: z.string().min(1).optional(),
  include_inactive: z.boolean().default(true),
});

export const runtime_list_connections_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-list_connections-1',
  node_name: 'list_connections',
  display_name: 'List connections',
  description:
    'Lists the current workspace app connections and their redacted status. Use this when the user asks which apps or accounts are connected.',
  category: 'context',
  input_schema: {
    type: 'object',
    properties: {
      app_name: {
        type: 'string',
        description: 'Optional app name to filter connections, for example gmail or slack.',
      },
      include_inactive: {
        type: 'boolean',
        description:
          'Whether to include pending, failed, revoked, or unhealthy connections. Defaults to true.',
      },
    },
  },
  output_schema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string' },
      result_count: { type: 'number' },
      connections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            connection_id: { type: 'string' },
            app_name: { type: 'string' },
            app_display_name: { type: 'string' },
            app_category: { type: 'string' },
            connection_name: { type: 'string' },
            connection_status: { type: 'string' },
            health_status: { type: 'string' },
            provider_key: { type: 'string' },
            external_account_name: { type: 'string' },
            connected_time: { type: 'string' },
            authenticated_hosts: { type: 'array', items: { type: 'string' } },
            api_protocol_headers: { type: 'object' },
            accessible: { type: 'boolean' },
          },
        },
      },
    },
    required: ['workspace_id', 'result_count', 'connections'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.list_connections',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true, policy_exempt: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-list_connections-1 requires a runtime execution context.',
        },
      };
    }

    const connections = await list_connection_snapshot(context.db, {
      workspace_id: context.workspace_id,
      ...(context.participants ? { participants: context.participants } : {}),
      room_private_to: context.room_private_to,
    });
    const visible_connections = connections
      .filter((connection) => matches_app_name(connection, input.app_name))
      .filter((connection) => input.include_inactive || connection.connection_status === 'active');

    return {
      success: true,
      data: {
        workspace_id: context.workspace_id,
        result_count: visible_connections.length,
        connections: visible_connections,
      },
      metadata: { source: 'workspace_connections' },
    };
  },
};

function matches_app_name(connection: ConnectionSnapshotItem, app_name: string | undefined) {
  if (!app_name) return true;
  return connection.app_name === app_name;
}
