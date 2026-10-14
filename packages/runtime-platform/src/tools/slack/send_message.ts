import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import {
  native_slack_app_name,
  native_slack_connection_profile,
} from '@runtime-platform/tools/slack/app_profile';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  channel_id: z.string().min(1),
  message: z.string().min(1),
  // Slack rejects more than 50 blocks; cap here so the required text stays as the fallback.
  blocks: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
  thread_ts: z.string().min(1).optional(),
  reply_broadcast: z.boolean().optional(),
  source_event_id: z.string().min(1).optional(),
});

export const slack_send_message_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'slack-send_message-1',
  node_name: 'send_message',
  display_name: 'Send Slack message',
  description:
    'Sends a Slack message to an explicit channel, thread, or direct-message destination. Use slack-respond-1 instead to answer the current Slack turn.',
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description:
          'Slack channel ID, or a user ID to send a direct message (the DM is opened automatically).',
      },
      message: {
        type: 'string',
        description:
          'Slack mrkdwn message text. Format links as <https://example.com|label> and bold as *text*; do not use GitHub Markdown links like [label](https://example.com). Also used as the notification and fallback text when blocks are set.',
      },
      blocks: {
        type: 'array',
        items: { type: 'object' },
        description:
          'Optional Slack Block Kit blocks. When set, message is still required as the notification and fallback text.',
      },
      thread_ts: { type: 'string', description: 'Slack thread timestamp to reply in.' },
      reply_broadcast: {
        type: 'boolean',
        description: 'Whether a threaded reply should also broadcast to the channel.',
      },
      source_event_id: {
        type: 'string',
        description: 'Slack event that justified this message. Required for scout actions.',
      },
    },
    required: ['channel_id', 'message'],
  },
  output_schema: {
    type: 'object',
    properties: {
      message_id: { type: 'string' },
      channel_id: { type: 'string' },
      thread_ts: { type: 'string' },
    },
  },
  app_name: native_slack_app_name,
  required_connection: true,
  connection_profile: native_slack_connection_profile,
  required_scopes: ['chat:write'],
  runtime_handler: 'slack.send_message',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: {
    provider: 'native_slack',
    policy_delegates_to_catalog: true,
    policy_labels: ['changes_things'],
    approval_display_fields: ['message', 'channel_id'],
  },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'slack-send_message-1 requires a runtime execution context.',
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
      node_key: 'slack-send_message-1',
      tool_input: input,
      ...(context.source_context ? { source_context: context.source_context } : {}),
    });
  },
};
