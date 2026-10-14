import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import {
  native_slack_app_name,
  native_slack_connection_profile,
} from '@runtime-platform/tools/slack/app_profile';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  file_id: z
    .string()
    .regex(/^(?:F[A-Z0-9]+|slack:[A-Z0-9]+:F[A-Z0-9]+)$/u)
    .max(200),
});

export const slack_read_file_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'slack-read_file-1',
  node_name: 'read_file',
  display_name: 'Read Slack file',
  description:
    'Downloads a Slack file into the runtime workspace and returns its path. Use this whenever you need to edit or inspect a file the user already sent or you already sent them — never regenerate it from memory. If you do not have its file_id, call slack-read_history-1 first to find it.',
  category: 'files',
  input_schema: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'File ID shown on a Slack message or returned by slack-read_history-1.',
      },
    },
    required: ['file_id'],
  },
  output_schema: {
    type: 'object',
    properties: {
      attachment_id: { type: 'string' },
      path: { type: 'string' },
      file_name: { type: 'string' },
      mime_type: { type: 'string' },
      byte_size: { type: 'number' },
    },
    required: ['attachment_id', 'path', 'file_name', 'mime_type', 'byte_size'],
  },
  app_name: native_slack_app_name,
  required_connection: true,
  connection_profile: native_slack_connection_profile,
  required_scopes: ['files:read'],
  runtime_handler: 'slack.read_file',
  approval_policy: { mode: 'none' },
  metadata: { provider: 'native_slack', policy_delegates_to_catalog: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'slack-read_file-1 requires a runtime execution context.',
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
      node_key: 'slack-read_file-1',
      tool_input: input,
      ...(context.environment ? { environment: context.environment } : {}),
    });
  },
};
