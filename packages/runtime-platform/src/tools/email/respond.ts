import { create_logger, format_error_message, type RuntimeToolResult } from '@coworker/shared';
import { read_trusted_email_turn_context } from '@runtime-platform/channels/email/event_payloads';
import { read_outbound_email_attachments } from '@runtime-platform/channels/email/outbound_attachments';
import {
  record_email_turn_reply,
  send_email_turn_reply,
} from '@runtime-platform/channels/email/turn_reply';
import type {
  RuntimeToolDefinition,
  RuntimeToolExecutionContext,
} from '@runtime-platform/tools/types';
import { z } from 'zod';

const email_response_schema = z.strictObject({
  resolution_type: z.literal('reply'),
  message: z.string().min(1),
  attachment_paths: z.array(z.string().min(1)).max(10).optional(),
});

const log = create_logger('email_respond');

export const email_respond_tool: RuntimeToolDefinition<typeof email_response_schema> = {
  node_key: 'email-respond-1',
  node_name: 'respond',
  display_name: 'Reply by email',
  description:
    'Sends one plain-text reply to the email that started this turn, threaded into the same conversation and copied to every other participant on the thread. Every email turn MUST end by calling this tool — plain assistant text is never delivered, so until it succeeds the sender has heard nothing. Write the complete reply as plain text (no markdown formatting).',
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      resolution_type: { type: 'string', enum: ['reply'] },
      message: {
        type: 'string',
        description: 'The complete plain-text reply the sender will read.',
      },
      attachment_paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional workspace file paths to attach, for example ["files/report.pdf"]. Up to 10 files, 25 MB total.',
      },
    },
    required: ['resolution_type', 'message'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      accepted: { type: 'boolean' },
      resolution_type: { type: 'string', enum: ['reply'] },
      delivered: { type: 'boolean' },
      email_id: { type: 'string' },
    },
    required: ['accepted', 'resolution_type', 'delivered'],
  },
  app_name: 'email',
  required_connection: false,
  runtime_handler: 'email.respond',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  available_on_source_types: ['email'],
  metadata: { safe_for_first_milestone: true },
  ends_run_on_success: true,
  validate_input: email_response_schema,
  async execute(input, context) {
    const email_turn = read_trusted_email_turn_context(context?.source_context);
    if (!context || !email_turn) {
      return {
        success: false,
        error: {
          code: 'email_turn_required',
          message: 'email-respond-1 is valid only during a trusted email-origin turn.',
        },
      };
    }

    try {
      const attachments = await read_outbound_email_attachments(context, input.attachment_paths);
      const sent = await send_email_turn_reply(
        context.db,
        context.workspace_id,
        email_turn,
        input.message,
        attachments,
        `email-respond/${context.run_id}`,
        context.tool_call_id,
      );
      await record_email_turn_reply(context.db, {
        workspace_id: context.workspace_id,
        session_id: context.session_id,
        email_id: sent.id,
        actor_id: context.actor_id,
      });
      return {
        success: true,
        data: {
          accepted: true,
          resolution_type: 'reply',
          delivered: true,
          email_id: sent.id,
          attachment_count: attachments.length,
        },
      };
    } catch (error) {
      return email_send_failed(context, error);
    }
  },
};

function email_send_failed(
  context: RuntimeToolExecutionContext,
  error: unknown,
): RuntimeToolResult {
  log.error('email reply failed to send', {
    workspace_id: context.workspace_id,
    run_id: context.run_id,
    error: format_error_message(error),
  });
  return {
    success: false,
    error: {
      code: 'email_send_failed',
      message: 'Sending the reply through the email provider failed. Try once more.',
    },
  };
}
