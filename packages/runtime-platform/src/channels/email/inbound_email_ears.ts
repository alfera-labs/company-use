import type { Database } from '@coworker/core';
import { list_workspace_member_users } from '@coworker/core/db/queries/workspace_membership';
import { fire_automation_ears } from '@runtime-platform/automations/fire_automation_ears';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { sender_is_trusted_member } from '@runtime-platform/channels/email/sender_authentication';
import { native_trigger_node_keys } from '@runtime-platform/tools/native_trigger_seed';

export async function fire_inbound_email_ears(
  db: Database,
  input: { workspace_id: string; message: InboundEmailMessage; received_time?: Date },
) {
  const message = input.message;
  const members = await list_workspace_member_users(db, input.workspace_id);
  return fire_automation_ears(db, {
    workspace_id: input.workspace_id,
    node_key: native_trigger_node_keys.inbound_email,
    occurrence_key: message.email_id,
    ...(input.received_time ? { received_time: input.received_time } : {}),
    data: {
      thread_id: read_thread_id(message),
      sender: message.from_email,
      sender_is_verified_member: sender_is_trusted_member(
        message,
        members.map((member) => member.email.toLowerCase()),
      ),
      subject: message.subject,
      message_text: message.body_text,
      message_id: message.message_id ?? message.email_id,
      received_time: (input.received_time ?? new Date()).toISOString(),
    },
  });
}

function read_thread_id(message: InboundEmailMessage) {
  return message.references?.[0] ?? message.in_reply_to ?? message.message_id ?? message.email_id;
}
