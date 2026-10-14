import type { Database } from '@coworker/core/db/connection';
import { run_messages, sessions } from '@coworker/core/db/schema';
import { and, desc, eq, gte, ne } from 'drizzle-orm';

const web_chat_session_source = 'dashboard';

export type LiveChatSession = { session_id: string; agent_id: string; last_message_time: Date };

export async function find_live_chat_session(
  db: Database,
  input: {
    workspace_id: string;
    user_id?: string | null | undefined;
    now?: Date | undefined;
    within_hours?: number | undefined;
  },
): Promise<LiveChatSession | null> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - (input.within_hours ?? 24) * 60 * 60 * 1_000);
  const [row] = await db
    .select({
      session_id: sessions.session_id,
      agent_id: sessions.agent_id,
      last_message_time: run_messages.created_time,
    })
    .from(run_messages)
    .innerJoin(sessions, eq(sessions.session_id, run_messages.session_id))
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        eq(run_messages.message_role, 'user'),
        gte(run_messages.created_time, since),
        eq(sessions.session_source, web_chat_session_source),
        ne(sessions.session_status, 'deleted'),
        ...(input.user_id ? [eq(run_messages.created_by, input.user_id)] : []),
      ),
    )
    .orderBy(desc(run_messages.created_time))
    .limit(1);
  return row ?? null;
}
