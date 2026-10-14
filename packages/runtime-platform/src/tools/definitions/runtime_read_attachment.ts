import { generate_agent_visible_path } from '@agent-core/environment/agent_visible_path';
import { format_error_message, ValidationError } from '@coworker/shared';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import { write_attachment_to_environment } from '@runtime-platform/attachments/write_attachment_to_environment';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({ attachment_id: z.string().min(1).max(200) });

export const runtime_read_attachment_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-read_attachment-1',
  node_name: 'read_attachment',
  display_name: 'Read Attachment',
  description:
    'Places the original bytes of a current-message attachment in the session workspace and returns its exact path for existing file tools.',
  category: 'files',
  input_schema: {
    type: 'object',
    properties: {
      attachment_id: {
        type: 'string',
        description:
          'The file_id exactly as it appears on the current message, for example slack:T0EXAMPLE01:F0EXAMPLE01.',
      },
    },
    required: ['attachment_id'],
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
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.read_attachment',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: input_schema,
  async execute(input, context) {
    try {
      const attachment = find_current_attachment(context?.attachment_sources, input.attachment_id);
      const workspace_path = await write_attachment_to_environment(
        context?.environment,
        attachment,
      );
      return {
        success: true,
        data: {
          attachment_id: attachment.attachment_id,
          path: generate_agent_visible_path(context?.environment, workspace_path),
          file_name: attachment.file_name,
          mime_type: attachment.mime_type,
          byte_size: attachment.byte_size,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error instanceof ValidationError ? error.code : 'attachment_unavailable',
          message: format_error_message(error, 'Attachment is unavailable'),
        },
      };
    }
  },
};

function find_current_attachment(
  sources: ReadonlyMap<string, RuntimeAttachmentSource> | undefined,
  attachment_id: string,
) {
  const attachment =
    sources?.get(attachment_id) ?? find_attachment_by_provider_file_id(sources, attachment_id);
  if (!attachment)
    throw new ValidationError(unavailable_attachment_message(sources, attachment_id));
  return attachment;
}

function find_attachment_by_provider_file_id(
  sources: ReadonlyMap<string, RuntimeAttachmentSource> | undefined,
  attachment_id: string,
) {
  if (!sources || attachment_id.includes(':')) return undefined;
  const matches = [...sources.values()].filter((source) =>
    source.attachment_id.endsWith(`:${attachment_id}`),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function unavailable_attachment_message(
  sources: ReadonlyMap<string, RuntimeAttachmentSource> | undefined,
  attachment_id: string,
) {
  const available = [...(sources?.keys() ?? [])];
  if (available.length === 0) {
    return 'No attachment is available in this run. Ask the user to share the file again on a new message — a file attached to an earlier message cannot be read now.';
  }
  return `Attachment ${attachment_id} is not available in this run. Available attachment ids: ${available.join(', ')}.`;
}
