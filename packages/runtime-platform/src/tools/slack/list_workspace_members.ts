import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import {
  native_slack_app_name,
  native_slack_connection_profile,
} from '@runtime-platform/tools/slack/app_profile';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  include_bots: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(200),
});

export const slack_list_workspace_members_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'slack-list_workspace_members-1',
  node_name: 'list_workspace_members',
  display_name: 'List Slack workspace members',
  description:
    'Lists current Slack workspace members from Slack users.list. Use this for live questions about how many people or members are in the workspace; do not answer those from memory. If counts_are_complete is false, state the count as at least the returned count instead of exact.',
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      include_bots: {
        type: 'boolean',
        description: 'Include bot accounts in the returned members list. Defaults to false.',
      },
      limit: {
        type: 'number',
        description:
          'Maximum member records to return. Counts cover the loaded Slack directory pages; check counts_are_complete before calling them exact.',
      },
    },
  },
  output_schema: {
    type: 'object',
    properties: {
      human_member_count: { type: 'number' },
      bot_count: { type: 'number' },
      counts_are_complete: { type: 'boolean' },
      directory_truncated: { type: 'boolean' },
      directory_pages_loaded: { type: 'number' },
      returned_member_count: { type: 'number' },
      members: { type: 'array', items: { type: 'object' } },
    },
    required: [
      'human_member_count',
      'bot_count',
      'counts_are_complete',
      'directory_truncated',
      'directory_pages_loaded',
      'returned_member_count',
      'members',
    ],
  },
  app_name: native_slack_app_name,
  required_connection: true,
  connection_profile: native_slack_connection_profile,
  required_scopes: ['users:read', 'users:read.email'],
  runtime_handler: 'slack.list_workspace_members',
  approval_policy: { mode: 'none' },
  metadata: { provider: 'native_slack', policy_delegates_to_catalog: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'slack-list_workspace_members-1 requires a runtime execution context.',
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
      node_key: 'slack-list_workspace_members-1',
      tool_input: input,
    });
  },
};
