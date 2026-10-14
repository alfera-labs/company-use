import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { count_workspace_tool_calls_since } from '@coworker/core/db/queries/sessions';
import { list_workspace_member_users } from '@coworker/core/db/queries/workspace_membership';
import { read_trusted_email_turn_context } from '@runtime-platform/channels/email/event_payloads';
import { read_email_thread_participants } from '@runtime-platform/channels/email/thread_participants';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

const member_authorized_source_types = new Set(['dashboard', 'slack']);
const capped_outbound_email_tool_names = ['email-send-1'];

export type OutboundEmailAuthorization =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

export async function authorize_outbound_email(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    recipients: string[];
    source_context?: RuntimeToolSourceContext;
  },
): Promise<OutboundEmailAuthorization> {
  const over_cap = await read_daily_send_cap_breach(db, input.workspace_id);
  if (over_cap) return over_cap;

  const unreachable = await find_unauthorized_recipients(db, input);
  if (unreachable.length === 0) return { allowed: true };

  return {
    allowed: false,
    code: 'recipient_not_authorized',
    message: `Cannot email ${unreachable.join(', ')} from this run: they are not a workspace member and not already part of this conversation, so a person has to ask for it. Ask the person you are working with to request the email (in chat, Slack, or by emailing you), then send it.`,
  };
}

async function find_unauthorized_recipients(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    recipients: string[];
    source_context?: RuntimeToolSourceContext;
  },
) {
  const recipients = [...new Set(input.recipients.map((address) => address.toLowerCase()))];
  const members = await list_workspace_member_users(db, input.workspace_id);
  const member_emails = new Set(members.map((member) => member.email.toLowerCase()));
  const unknown = recipients.filter((recipient) => !member_emails.has(recipient));
  if (unknown.length === 0) return [];

  const participants = new Set(
    await read_email_thread_participants(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
    }),
  );
  const strangers = unknown.filter((recipient) => !participants.has(recipient));
  if (strangers.length === 0) return [];

  return turn_is_member_authorized(input.source_context) ? [] : strangers;
}

function turn_is_member_authorized(source_context?: RuntimeToolSourceContext) {
  const source_type = source_context?.source_type ?? 'dashboard';
  if (member_authorized_source_types.has(source_type)) return true;
  if (source_type !== 'email') return false;
  return read_trusted_email_turn_context(source_context)?.sender_is_workspace_member === true;
}

async function read_daily_send_cap_breach(
  db: Database,
  workspace_id: string,
): Promise<OutboundEmailAuthorization | null> {
  const limit = env.EMAIL_DAILY_SEND_LIMIT;
  const sent_today = await count_workspace_tool_calls_since(db, {
    workspace_id,
    tool_names: capped_outbound_email_tool_names,
    since: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });
  if (sent_today < limit) return null;

  return {
    allowed: false,
    code: 'email_daily_limit_reached',
    message: `This workspace has already started ${sent_today} email conversations in the last 24 hours (limit ${limit}). Tell the person what you were going to send instead of sending it.`,
  };
}
