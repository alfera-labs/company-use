import { create_external_source_actor, type SourceActor } from '@coworker/shared';
import type { EmailTurnMetadata } from '@runtime-platform/channels/email/event_payloads';
import { parse_email_address } from '@runtime-platform/channels/email/inbound_address';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { sender_domain_is_authenticated } from '@runtime-platform/channels/email/sender_authentication';

export type EmailTurnFacts = {
  workspace_address: string;
  message: InboundEmailMessage;
  thread: {
    session_id: string;
    participants: string[];
    has_member_participant: boolean;
    session_source: string;
  };
};

// Providers accept at most 50 addresses across to/cc/bcc, and participants accumulate for the
// life of a thread — every sender, every Cc, and everyone the agent writes to. A long-running
// thread would eventually exceed the cap, the send would be rejected, and the person would get
// the runtime's "couldn't compose a reply" notice instead of the answer. The most recent
// participants are kept, because they are the ones actually still in the conversation.
const reply_recipient_limit = 49;

export function build_email_turn_metadata(facts: EmailTurnFacts): EmailTurnMetadata {
  const message = facts.message;
  const reply_to_email = message.reply_to_email ?? message.from_email;
  return {
    email_id: message.email_id,
    workspace_address: facts.workspace_address,
    from: message.from,
    reply_to_email,
    reply_cc: facts.thread.has_member_participant
      ? facts.thread.participants
          .filter((participant) => participant !== reply_to_email)
          .slice(-reply_recipient_limit)
      : [],
    reply_expected: facts.thread.session_source === 'email',
    subject: message.subject,
    ...(message.message_id ? { message_id: message.message_id } : {}),
    ...(message.references?.length ? { references: message.references } : {}),
  };
}

export function build_email_source_actor(message: InboundEmailMessage): SourceActor {
  const display_name = parse_email_address(message.from)?.display_name;
  return create_external_source_actor({
    provider_key: 'email',
    external_user_id: message.from_email,
    profile: {
      display_name: display_name ?? message.from_email,
      email: message.from_email,
      email_is_verified: sender_domain_is_authenticated(message.sender_authentication),
      profile_source: 'event_payload',
    },
    policy_state: 'allowed_to_chat',
  });
}
