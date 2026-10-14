import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import {
  native_slack_app_name,
  native_slack_connection_profile,
} from '@runtime-platform/tools/slack/app_profile';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const slack_list_channels_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'slack-list_channels-1',
  node_name: 'list_channels',
  display_name: 'List Slack channels',
  description: 'Lists Slack channels for a connected workspace.',
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Maximum channels to list.' },
      cursor: { type: 'string', description: 'Slack pagination cursor.' },
    },
  },
  output_schema: {
    type: 'object',
    properties: {
      channels: {
        type: 'array',
        items: { type: 'object' },
      },
    },
    required: ['channels'],
  },
  app_name: native_slack_app_name,
  required_connection: true,
  connection_profile: native_slack_connection_profile,
  required_scopes: ['channels:read'],
  runtime_handler: 'slack.list_channels',
  approval_policy: { mode: 'none' },
  metadata: { provider: 'native_slack', policy_delegates_to_catalog: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'slack-list_channels-1 requires a runtime execution context.',
        },
      };
    }

    return execute_catalog_tool(context.db, {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      ...(context.agent_id ? { agent_id: context.agent_id } : {}),
      actor_id: context.actor_id,
      ...(context.participants ? { participants: context.participants } : {}),
      room_private_to: context.room_private_to,
      node_key: 'slack-list_channels-1',
      tool_input: input,
    });
  },
};
