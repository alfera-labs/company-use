import type { Database } from '@coworker/core';
import { find_workspace_inbound_email_username } from '@coworker/core/db/queries/workspace_inbound_email';
import { read_workspace_inbound_email_settings } from '@coworker/core/db/queries/workspace_inbound_email_settings';
import { find_workspace_profile } from '@coworker/core/db/queries/workspace_provisioning';
import { AppError } from '@coworker/shared';
import { append_email_attribution } from '@runtime-platform/channels/email/attribution';
import { build_inbound_email_address } from '@runtime-platform/channels/email/inbound_address';
import { authorize_outbound_email } from '@runtime-platform/channels/email/outbound_policy';
import {
  fetch_sent_email_message_id,
  type SendEmailAttachment,
  send_email_reply,
} from '@runtime-platform/channels/email/resend_api';
import { sent_by_tool_call_tag } from '@runtime-platform/channels/email/sent_email_lookup';
import { record_sent_email_message_id } from '@runtime-platform/channels/email/sent_messages';
import { add_email_thread_participants } from '@runtime-platform/channels/email/thread_participants';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

export type SendWorkspaceEmailInput = {
  workspace_id: string;
  session_id: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  attachments?: SendEmailAttachment[];
  actor_id: string;
  source_context?: RuntimeToolSourceContext;
  tool_call_id?: string;
};

export type SentWorkspaceEmail = {
  email_id: string;
  from: string;
  to: string[];
  cc: string[];
  message_id?: string;
};

async function read_workspace_sender_address(db: Database, workspace_id: string) {
  const username = await find_workspace_inbound_email_username(db, workspace_id);
  if (!username) {
    throw new AppError(
      'workspace_email_address_missing',
      'This workspace has no email address yet. Create one with email-create_address-1 first, then send.',
      409,
    );
  }
  return build_inbound_email_address(username);
}

async function record_sent_workspace_email(
  db: Database,
  input: SendWorkspaceEmailInput,
  sent: { cc: string[]; sent_email_id: string },
) {
  await add_email_thread_participants(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    participants: [...input.to, ...sent.cc],
    actor_id: input.actor_id,
  });
  const message_id = await fetch_sent_email_message_id(sent.sent_email_id);
  if (message_id) {
    await record_sent_email_message_id(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      message_id,
      actor_id: input.actor_id,
    });
  }
  return message_id;
}

export async function send_workspace_email(
  db: Database,
  input: SendWorkspaceEmailInput,
): Promise<SentWorkspaceEmail> {
  const from = await read_workspace_sender_address(db, input.workspace_id);
  const cc = input.cc ?? [];
  const authorization = await authorize_outbound_email(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    recipients: [...input.to, ...cc],
    ...(input.source_context ? { source_context: input.source_context } : {}),
  });
  if (!authorization.allowed) {
    throw new AppError(authorization.code, authorization.message, 403);
  }

  const [{ attribution_enabled }, workspace] = await Promise.all([
    read_workspace_inbound_email_settings(db, input.workspace_id),
    find_workspace_profile(db, input.workspace_id),
  ]);
  const sent = await send_email_reply({
    from,
    to: input.to,
    ...(cc.length ? { cc } : {}),
    subject: input.subject,
    text: append_email_attribution(input.text, attribution_enabled, workspace?.workspace_name),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.tool_call_id
      ? {
          idempotency_key: `tool-call/${input.tool_call_id}`,
          tags: [sent_by_tool_call_tag(input.tool_call_id)],
        }
      : {}),
  });

  const message_id = await record_sent_workspace_email(db, input, { cc, sent_email_id: sent.id });
  return { email_id: sent.id, from, to: input.to, cc, ...(message_id ? { message_id } : {}) };
}
