import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import {
  native_slack_app_name,
  native_slack_connection_profile,
} from '@runtime-platform/tools/slack/app_profile';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  channel_id: z.string().min(1),
});

export const slack_join_channel_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'slack-join_channel-1',
  node_name: 'join_channel',
  display_name: 'Join Slack channel',
  description: 'Joins a public Slack channel.',
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      channel_id: { type: 'string', description: 'Slack channel ID to join.' },
    },
    required: ['channel_id'],
  },
  output_schema: {
    type: 'object',
    properties: {
      channel_id: { type: 'string' },
      already_in_channel: { type: 'boolean' },
      channel: { type: 'object' },
    },
  },
  app_name: native_slack_app_name,
  required_connection: true,
  connection_profile: native_slack_connection_profile,
  required_scopes: ['channels:join'],
  runtime_handler: 'slack.join_channel',
  approval_policy: { mode: 'none' },
  metadata: {
    provider: 'native_slack',
    policy_delegates_to_catalog: true,
    policy_labels: ['changes_things'],
  },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'slack-join_channel-1 requires a runtime execution context.',
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
      node_key: 'slack-join_channel-1',
      tool_input: input,
    });
  },
};
