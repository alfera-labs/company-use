import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import {
  native_slack_app_name,
  native_slack_connection_profile,
} from '@runtime-platform/tools/slack/app_profile';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  channel_id: z.string().min(1).optional(),
  file_path: z.string().min(1),
  filename: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  initial_comment: z.string().min(1).optional(),
  thread_ts: z.string().min(1).optional(),
  alt_text: z.string().min(1).optional(),
  source_event_id: z.string().min(1).optional(),
});

export const slack_upload_file_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'slack-upload_file-1',
  node_name: 'upload_file',
  display_name: 'Upload Slack file',
  description:
    'Uploads a file from the runtime workspace into a Slack channel or thread. Use this after creating a report, PDF, image, spreadsheet, or other artifact that the user wants attached in Slack.',
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description:
          'Slack channel ID, or a user ID to upload into a direct message (the DM is opened/reused automatically). Optional when this turn came from Slack; defaults to the current Slack channel.',
      },
      file_path: {
        type: 'string',
        description: `Runtime workspace path to the file, for example files/report.pdf or ${current_workspace_layout.model_root}/files/report.pdf.`,
      },
      filename: {
        type: 'string',
        description: 'Optional filename to show in Slack. Defaults to the basename of file_path.',
      },
      title: { type: 'string', description: 'Optional display title for the Slack file.' },
      initial_comment: {
        type: 'string',
        description: 'Optional message text to send with the uploaded file.',
      },
      thread_ts: {
        type: 'string',
        description:
          'Slack thread timestamp to upload the file as a thread reply. Optional when this turn came from Slack; defaults to the current Slack thread.',
      },
      alt_text: {
        type: 'string',
        description: 'Optional accessibility description for image files.',
      },
      source_event_id: {
        type: 'string',
        description: 'Slack event that justified this upload. Required for scout actions.',
      },
    },
    required: ['file_path'],
  },
  output_schema: {
    type: 'object',
    properties: {
      channel_id: { type: 'string' },
      thread_ts: { type: 'string' },
      file_path: { type: 'string' },
      filename: { type: 'string' },
      files: { type: 'array', items: { type: 'object' } },
    },
  },
  app_name: native_slack_app_name,
  required_connection: true,
  connection_profile: native_slack_connection_profile,
  required_scopes: ['files:write', 'im:write'],
  runtime_handler: 'slack.upload_file',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: {
    provider: 'native_slack',
    policy_delegates_to_catalog: true,
    policy_labels: ['changes_things'],
    approval_display_fields: ['file_path', 'channel_id', 'initial_comment'],
  },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'slack-upload_file-1 requires a runtime execution context.',
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
      node_key: 'slack-upload_file-1',
      tool_input: input,
      ...(context.environment ? { environment: context.environment } : {}),
      ...(context.source_context ? { source_context: context.source_context } : {}),
    });
  },
};
