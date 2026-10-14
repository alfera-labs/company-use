import type { Database } from '@coworker/core';
import { create_session } from '@coworker/core/db/queries/sessions';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { thread_has_member } from '@runtime-platform/channels/email/thread_participants';
import type { EmailThreadSession } from '@runtime-platform/channels/email/thread_sessions';
import { normalize_email_subject } from '@runtime-platform/channels/email/turn_subject';

export type CreateEmailThreadSessionInput = {
  workspace_id: string;
  default_agent_id: string;
  workspace_address: string;
  message: InboundEmailMessage;
  thread_keys: string[];
  taken_thread_keys: Set<string>;
  message_participants: string[];
  member_emails: string[];
  sender_is_member: boolean;
  actor_id: string;
  project_id?: string;
};

export async function create_email_thread_session(
  db: Database,
  input: CreateEmailThreadSessionInput,
): Promise<EmailThreadSession | null> {
  try {
    const created = await create_session(db, {
      workspace_id: input.workspace_id,
      agent_id: input.default_agent_id,
      source_type: 'email',
      session_source: 'email',
      external_thread_key: build_creation_thread_key(input),
      session_title: `Email: ${input.message.subject}`,
      source_metadata: {
        email: {
          workspace_address: input.workspace_address,
          subject: input.message.subject,
          participants: input.message_participants,
        },
      },
      actor_id: input.actor_id,
      ...(input.project_id ? { project_id: input.project_id } : {}),
    });
    return {
      session_id: created.session_id,
      agent_id: created.agent_id,
      participants: input.message_participants,
      has_member_participant: thread_has_member(
        input.message_participants,
        input.member_emails,
        input.sender_is_member,
        input.sender_is_member ? undefined : input.message.from_email,
      ),
      session_source: 'email',
    };
  } catch (error) {
    if (!is_unique_violation(error)) throw error;
    return null;
  }
}

function build_creation_thread_key(input: CreateEmailThreadSessionInput) {
  return (
    input.thread_keys.find((key) => !input.taken_thread_keys.has(key)) ??
    `email:${input.workspace_id}:${input.message.from_email}:${normalize_email_subject(input.message.subject)}`
  );
}

// The driver may wrap the Postgres error (drizzle raises its own error with the pg error as
// `cause`), so the unique-violation code is looked up along the cause chain.
function is_unique_violation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === '23505') return true;
  return is_unique_violation((error as { cause?: unknown }).cause);
}
