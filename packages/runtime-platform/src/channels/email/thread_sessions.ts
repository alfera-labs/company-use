import { type Database, sessions } from '@coworker/core';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { sender_is_trusted_member } from '@runtime-platform/channels/email/sender_authentication';
import { find_session_by_sent_message_id } from '@runtime-platform/channels/email/sent_messages';
import {
  add_email_thread_participants,
  email_message_participants,
  parse_email_session_metadata,
  thread_has_member,
} from '@runtime-platform/channels/email/thread_participants';
import { create_email_thread_session } from '@runtime-platform/channels/email/thread_session_create';
import { normalize_email_subject } from '@runtime-platform/channels/email/turn_subject';
import { and, eq, inArray } from 'drizzle-orm';

export type EmailThreadSession = {
  session_id: string;
  agent_id: string;
  participants: string[];
  has_member_participant: boolean;
  session_source: string;
};

function list_sessions_for_thread_keys(
  db: Database,
  input: { workspace_id: string; thread_keys: string[] },
) {
  return db.query.sessions.findMany({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.session_source, 'email'),
      inArray(sessions.external_thread_key, input.thread_keys),
    ),
  });
}

function candidate_email_thread_keys(workspace_id: string, message: InboundEmailMessage): string[] {
  const message_ids = [
    ...(message.references ?? []),
    ...(message.in_reply_to ? [message.in_reply_to] : []),
    ...(message.message_id ? [message.message_id] : []),
  ];
  const keys = [...new Set(message_ids)].map((id) => `email:${workspace_id}:${id}`);
  if (keys.length > 0) return keys;
  return [
    `email:${workspace_id}:${message.from_email}:${normalize_email_subject(message.subject)}`,
  ];
}

export async function find_or_create_email_thread_session(
  db: Database,
  input: {
    workspace_id: string;
    default_agent_id: string;
    workspace_address: string;
    message: InboundEmailMessage;
    member_emails: string[];
    actor_id: string;
    project_id?: string;
  },
): Promise<EmailThreadSession> {
  const member_emails = input.member_emails.map((email) => email.toLowerCase());
  const sender_is_member = sender_is_trusted_member(input.message, member_emails);
  const message_participants = email_message_participants(input.message);
  const thread_keys = candidate_email_thread_keys(input.workspace_id, input.message);

  const joinable =
    (await find_sent_message_thread_session(db, { ...input, sender_is_member })) ??
    (await find_header_thread_session(db, { ...input, thread_keys, sender_is_member }));
  if (joinable) {
    const participants = await add_email_thread_participants(db, {
      workspace_id: input.workspace_id,
      session_id: joinable.session_id,
      participants: message_participants,
      actor_id: input.actor_id,
    });
    return {
      ...joinable,
      participants,
      has_member_participant: thread_has_member(
        participants,
        member_emails,
        sender_is_member,
        sender_is_member ? undefined : input.message.from_email,
      ),
    };
  }

  const created = await create_email_thread_session(db, {
    ...input,
    thread_keys,
    message_participants,
    member_emails,
    sender_is_member,
    taken_thread_keys: await read_taken_thread_keys(db, { ...input, thread_keys }),
  });
  return created ?? find_or_create_email_thread_session(db, input);
}

async function read_taken_thread_keys(
  db: Database,
  input: { workspace_id: string; thread_keys: string[] },
) {
  const sessions_for_keys = await list_sessions_for_thread_keys(db, input);
  return new Set(
    sessions_for_keys.flatMap((session) =>
      session.external_thread_key ? [session.external_thread_key] : [],
    ),
  );
}

async function find_sent_message_thread_session(
  db: Database,
  input: { workspace_id: string; message: InboundEmailMessage; sender_is_member: boolean },
) {
  const quoted_message_ids = [
    ...(input.message.in_reply_to ? [input.message.in_reply_to] : []),
    ...(input.message.references ?? []).slice().reverse(),
  ];
  const session = await find_session_by_sent_message_id(db, {
    workspace_id: input.workspace_id,
    message_ids: [...new Set(quoted_message_ids)],
  });
  if (!session) return null;

  const participants = parse_email_session_metadata(session.source_metadata).email.participants;
  if (!input.sender_is_member && !participants.includes(input.message.from_email)) return null;
  return {
    session_id: session.session_id,
    agent_id: session.agent_id,
    session_source: session.session_source,
  };
}

async function find_header_thread_session(
  db: Database,
  input: {
    workspace_id: string;
    thread_keys: string[];
    message: InboundEmailMessage;
    sender_is_member: boolean;
  },
) {
  for (const session of await list_sessions_for_thread_keys(db, input)) {
    const participants = parse_email_session_metadata(session.source_metadata).email.participants;
    if (input.sender_is_member || participants.includes(input.message.from_email)) {
      return {
        session_id: session.session_id,
        agent_id: session.agent_id,
        session_source: session.session_source,
      };
    }
  }
  return null;
}
