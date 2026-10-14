import { type Database, sessions } from '@coworker/core';
import { parse_email_session_metadata } from '@runtime-platform/channels/email/thread_participants';
import { and, eq, sql } from 'drizzle-orm';

const sent_message_id_limit = 50;

export async function record_sent_email_message_id(
  db: Database,
  input: { workspace_id: string; session_id: string; message_id: string; actor_id: string },
): Promise<void> {
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.session_id, input.session_id),
    ),
  });
  if (!session) return;

  const metadata = parse_email_session_metadata(session.source_metadata);
  const sent_message_ids = [
    ...new Set([...metadata.email.sent_message_ids, input.message_id]),
  ].slice(-sent_message_id_limit);

  await db
    .update(sessions)
    .set({
      source_metadata: { ...metadata, email: { ...metadata.email, sent_message_ids } },
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    );
}

export async function find_session_by_sent_message_id(
  db: Database,
  input: { workspace_id: string; message_ids: string[] },
) {
  for (const message_id of input.message_ids) {
    const [session] = await db
      .select({
        session_id: sessions.session_id,
        agent_id: sessions.agent_id,
        session_source: sessions.session_source,
        source_metadata: sessions.source_metadata,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.workspace_id, input.workspace_id),
          sql`${sessions.source_metadata} -> 'email' -> 'sent_message_ids' @> ${JSON.stringify([message_id])}::jsonb`,
        ),
      )
      .limit(1);
    if (session) return session;
  }
  return null;
}
