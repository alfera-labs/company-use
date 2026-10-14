import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';
import { z } from 'zod';

export const resend_received_webhook_schema = z
  .object({
    type: z.literal('email.received'),
    data: z
      .object({
        email_id: z.string().min(1),
        from: z.string().min(1),
        to: z.array(z.string()).default([]),
        cc: z.array(z.string()).default([]),
        received_for: z.array(z.string()).default([]),
        subject: z.string().default('(no subject)'),
        message_id: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const email_event_body_schema = z.object({
  email_id: z.string().min(1),
  from: z.string().min(1),
  from_email: z.string().min(1),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string(),
  message_id: z.string().optional(),
  workspace_username: z.string().min(1),
});

export type EmailEventBody = z.infer<typeof email_event_body_schema>;

export const email_turn_metadata_schema = z
  .object({
    email_id: z.string().min(1),
    workspace_address: z.string().min(1),
    from: z.string().optional(),
    reply_to_email: z.string().min(1),
    reply_cc: z.array(z.string()).default([]),
    sender_is_workspace_member: z.boolean().optional(),
    reply_expected: z.boolean().default(true),
    subject: z.string(),
    message_id: z.string().optional(),
    references: z.array(z.string()).optional(),
  })
  .passthrough();

export type EmailTurnMetadata = z.infer<typeof email_turn_metadata_schema>;

export type TrustedEmailTurnContext = EmailTurnMetadata;

const email_source_metadata_schema = z.object({ email: email_turn_metadata_schema }).passthrough();

export function read_trusted_email_turn_context(
  source_context?: RuntimeToolSourceContext,
): TrustedEmailTurnContext | null {
  if (source_context?.source_type !== 'email') return null;

  const parsed = email_source_metadata_schema.safeParse(source_context.source_metadata);
  return parsed.success ? parsed.data.email : null;
}
