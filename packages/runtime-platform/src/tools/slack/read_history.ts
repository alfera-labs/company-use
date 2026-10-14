import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import {
  native_slack_app_name,
  native_slack_connection_profile,
} from '@runtime-platform/tools/slack/app_profile';
import { synced_library_hint } from '@runtime-platform/tools/slack/read_history_library_hint';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const default_hours_back = 24 * 30;

const input_schema = z.object({
  channel_id: z.string().min(1),
  thread_ts: z.string().min(1).optional(),
  hours_back: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(default_hours_back),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const slack_read_history_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'slack-read_history-1',
  node_name: 'read_history',
  display_name: 'Read Slack history',
  description: `Reads messages and file IDs from a Slack channel the bot is a member of, newest first, each with its ISO time. Pass thread_ts to read one thread whole, or next_cursor to read the next page. Use slack-read_file-1 to open a returned file. It returns text only: no reactions, no edit marks, no thread structure.${synced_library_hint}`,
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description:
          'Slack channel ID (e.g. C0123ABCDEF). Get it from slack-list_channels-1 — never construct or guess one.',
      },
      thread_ts: {
        type: 'string',
        description:
          'Optional thread timestamp: read that thread instead of the channel. A thread is read whole, however old it is — hours_back is ignored for it.',
      },
      hours_back: {
        type: 'number',
        description: `How far back to read a channel, in hours (default ${default_hours_back}, max 2160). Ignored when thread_ts is passed.`,
      },
      limit: { type: 'number', description: 'Maximum messages to return (default 50, max 100).' },
      cursor: {
        type: 'string',
        description: 'The next_cursor from a previous call: reads the next page.',
      },
    },
    required: ['channel_id'],
  },
  output_schema: {
    type: 'object',
    properties: {
      messages: { type: 'array', items: { type: 'object' } },
      has_more: { type: 'boolean' },
      next_cursor: { type: 'string' },
    },
    required: ['messages'],
  },
  app_name: native_slack_app_name,
  required_connection: true,
  connection_profile: native_slack_connection_profile,
  required_scopes: ['channels:history'],
  runtime_handler: 'slack.read_history',
  approval_policy: { mode: 'none' },
  metadata: { provider: 'native_slack', policy_delegates_to_catalog: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'slack-read_history-1 requires a runtime execution context.',
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
      node_key: 'slack-read_history-1',
      tool_input: input,
    });
  },
};
