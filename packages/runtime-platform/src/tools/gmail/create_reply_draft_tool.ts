import { AppError } from '@coworker/shared';
import { create_reply_draft } from '@runtime-platform/tools/gmail/create_reply_draft';
import { find_gmail_connection } from '@runtime-platform/tools/gmail/gmail_connection';
import { create_gmail_transport } from '@runtime-platform/tools/gmail/gmail_transport';
import { read_reply_attachments } from '@runtime-platform/tools/gmail/reply_attachments';
import { reply_draft_input_json_schema } from '@runtime-platform/tools/gmail/reply_draft_input_json_schema';
import type {
  RuntimeToolDefinition,
  RuntimeToolExecutionContext,
} from '@runtime-platform/tools/types';
import { z } from 'zod';

const email_address_schema = z.string().trim().email();
const address_list_schema = z.array(email_address_schema).max(20).optional();

const input_schema = z
  .strictObject({
    reply_to_message_id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]+$/u),
    subject: z.string().trim().min(1).max(250),
    body: z.string().min(1),
    body_type: z.enum(['html', 'plaintext']).default('plaintext'),
    to: address_list_schema,
    cc: address_list_schema,
    bcc: address_list_schema,
    attachment_paths: z.array(z.string().trim().min(1)).max(10).optional(),
    attachment_names: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
    connection_id: z.string().trim().min(1).optional(),
  })
  .refine(
    (input) => (input.attachment_names?.length ?? 0) <= (input.attachment_paths?.length ?? 0),
    { message: 'attachment_names cannot be longer than attachment_paths.' },
  );

type ReplyDraftInput = z.infer<typeof input_schema>;

export const gmail_create_reply_draft_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-create_gmail_reply_draft-1',
  node_name: 'create_gmail_reply_draft',
  display_name: 'Create Gmail reply draft',
  description:
    'Creates a Gmail draft that replies in the original thread and keeps the subject you give. Never sends. A thread keeps one reply draft: calling it again for the same thread replaces the earlier draft it wrote, unless a person has edited that draft, so never delete an earlier draft yourself.',
  category: 'communication',
  input_schema: reply_draft_input_json_schema,
  output_schema: {
    type: 'object',
    properties: {
      draft_id: { type: 'string' },
      message_id: { type: 'string' },
      thread_id: { type: 'string' },
      same_thread: { type: 'boolean' },
      subject: { type: 'string' },
      attachments: { type: 'array', items: { type: 'object' } },
      replaced_draft_ids: { type: 'array', items: { type: 'string' } },
      earlier_drafts_not_removed: { type: 'array', items: { type: 'string' } },
    },
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.create_gmail_reply_draft',
  approval_policy: { mode: 'none' },
  metadata: { policy_labels: ['changes_things'], approval_display_fields: ['subject', 'to'] },
  policy_timeout_ms: () => 180_000,
  find_policy_connection_id: async (db, request) => {
    const parsed = input_schema.safeParse(request.tool_input);
    const found = await find_gmail_connection(db, {
      ...request,
      connection_id: parsed.success ? parsed.data.connection_id : undefined,
    });
    return found.ok ? found.connection.connection_id : null;
  },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return tool_error('runtime_context_unavailable', 'This tool needs a runtime context.');
    }
    const found = await find_gmail_connection(context.db, {
      workspace_id: context.workspace_id,
      connection_id: input.connection_id,
      participants: context.participants,
      room_private_to: context.room_private_to,
    });
    if (!found.ok) return tool_error(found.code, found.message);
    const metadata = {
      connection_id: found.connection.connection_id,
      provider: found.connection.provider_key,
    };
    try {
      const draft = await create_draft_through(found.connection, input, context);
      return { success: true, data: draft, metadata };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return tool_error(error.code, error.message, { ...metadata, details: error.details ?? null });
    }
  },
};

async function create_draft_through(
  connection: Parameters<typeof create_gmail_transport>[0],
  input: ReplyDraftInput,
  context: RuntimeToolExecutionContext,
) {
  const transport = create_gmail_transport(connection, {
    workspace_id: context.workspace_id,
    signal: context.signal,
  });
  const attachments = await read_reply_attachments(context.environment, {
    file_paths: input.attachment_paths ?? [],
    file_names: input.attachment_names ?? [],
  });
  return create_reply_draft(transport, {
    reply_to_message_id: input.reply_to_message_id,
    subject: input.subject,
    body: input.body,
    body_type: input.body_type,
    to: input.to ?? [],
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    attachments,
  });
}

function tool_error(code: string, message: string, metadata: Record<string, unknown> = {}) {
  return { success: false as const, error: { code, message }, metadata };
}
