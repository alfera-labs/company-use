import { type Database, sessions } from '@coworker/core';
import {
  parse_email_address,
  read_inbound_email_username,
} from '@runtime-platform/channels/email/inbound_address';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const email_session_metadata_schema = z
  .object({
    email: z
      .object({
        participants: z.array(z.string()).default([]),
        sent_message_ids: z.array(z.string()).default([]),
      })
      .passthrough()
      .default({ participants: [], sent_message_ids: [] }),
  })
  .passthrough();

export type EmailSessionMetadata = z.infer<typeof email_session_metadata_schema>;

export function parse_email_session_metadata(source_metadata: unknown): EmailSessionMetadata {
  return email_session_metadata_schema.parse(source_metadata ?? {});
}

export function email_message_participants(message: InboundEmailMessage): string[] {
  return normalize_participants([message.from, ...message.to, ...message.cc]);
}

function normalize_participants(addresses: string[]): string[] {
  const emails = addresses.flatMap((raw) => {
    const email = parse_email_address(raw)?.email;
    return email && !read_inbound_email_username(email) ? [email] : [];
  });
  return [...new Set(emails)];
}

export async function read_email_thread_participants(
  db: Database,
  input: { workspace_id: string; session_id: string },
): Promise<string[]> {
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.session_id, input.session_id),
    ),
  });
  if (!session) return [];
  return parse_email_session_metadata(session.source_metadata).email.participants;
}

export async function add_email_thread_participants(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    participants: string[];
    actor_id: string;
  },
): Promise<string[]> {
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.session_id, input.session_id),
    ),
  });
  if (!session) return [];

  const metadata = parse_email_session_metadata(session.source_metadata);
  const participants = [
    ...new Set([...metadata.email.participants, ...normalize_participants(input.participants)]),
  ];
  if (participants.length === metadata.email.participants.length) return participants;

  await db
    .update(sessions)
    .set({
      source_metadata: { ...metadata, email: { ...metadata.email, participants } },
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    );
  return participants;
}

export function thread_has_member(
  participants: string[],
  member_emails: string[],
  sender_is_member: boolean,
  unauthenticated_sender_email?: string,
) {
  if (sender_is_member) return true;
  return participants.some(
    (participant) =>
      member_emails.includes(participant) && participant !== unauthenticated_sender_email,
  );
}
