import { AppError } from '@coworker/shared';
import { read_outbound_email_attachments } from '@runtime-platform/channels/email/outbound_attachments';
import { send_workspace_email } from '@runtime-platform/channels/email/outbound_email';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const email_address_schema = z.string().trim().toLowerCase().email();

const input_schema = z.strictObject({
  to: z.array(email_address_schema).min(1).max(10),
  cc: z.array(email_address_schema).max(10).optional(),
  subject: z.string().trim().min(1).max(200),
  attachment_paths: z.array(z.string().min(1)).max(10).optional(),
  message: z.string().min(1),
});

export const email_send_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'email-send-1',
  node_name: 'send',
  display_name: 'Send an email',
  description:
    "Sends an email from this workspace's own address to start a conversation — ask someone a question, send an update, contact a vendor. Replies come back to you automatically and continue THIS conversation, so you can ask and then carry on when the answer arrives (you do not need to wait inside this turn; end your turn normally and you will be started again with their reply). Use email-respond-1 instead to answer an email that is already the subject of this turn. Teammates and people already on this conversation can always be emailed; writing to anyone else requires that a person asked you to in this run.",
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      to: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description: 'Recipient email addresses.',
      },
      cc: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 10,
        description: 'Optional addresses to copy.',
      },
      subject: { type: 'string', minLength: 1, maxLength: 200 },
      attachment_paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional workspace file paths to attach, for example ["files/report.pdf"]. Up to 10 files, 25 MB total.',
      },
      message: {
        type: 'string',
        description:
          'The complete plain-text email body. Sign off as yourself; the reply comes back to you.',
      },
    },
    required: ['to', 'subject', 'message'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      sent: { type: 'boolean' },
      from: { type: 'string' },
      to: { type: 'array', items: { type: 'string' } },
      cc: { type: 'array', items: { type: 'string' } },
      email_id: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['sent', 'from', 'to', 'summary'],
  },
  app_name: 'email',
  required_connection: false,
  runtime_handler: 'email.send',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: { safe_for_first_milestone: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'email-send-1 requires a runtime execution context.',
        },
      };
    }

    try {
      const attachments = await read_outbound_email_attachments(context, input.attachment_paths);
      const sent = await send_workspace_email(context.db, {
        workspace_id: context.workspace_id,
        session_id: context.session_id,
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        subject: input.subject,
        text: input.message,
        ...(attachments.length ? { attachments } : {}),
        actor_id: context.actor_id,
        ...(context.source_context ? { source_context: context.source_context } : {}),
        ...(context.tool_call_id ? { tool_call_id: context.tool_call_id } : {}),
      });
      return {
        success: true,
        data: {
          sent: true,
          from: sent.from,
          to: sent.to,
          cc: sent.cc,
          email_id: sent.email_id,
          summary: `Emailed ${sent.to.join(', ')} from ${sent.from}. Their reply will come back to this conversation.`,
        },
      };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, error: { code: error.code, message: error.message } };
      }
      throw error;
    }
  },
};
