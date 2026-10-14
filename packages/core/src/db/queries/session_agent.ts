import type { Database } from '@coworker/core/db/connection';
import { agents, sessions } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

export async function find_session_with_agent(
  db: Database,
  input: { workspace_id: string; session_id: string },
) {
  const [row] = await db
    .select({ session_id: sessions.session_id, agent: agents })
    .from(sessions)
    .leftJoin(
      agents,
      and(eq(agents.workspace_id, sessions.workspace_id), eq(agents.agent_id, sessions.agent_id)),
    )
    .where(
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    )
    .limit(1);
  return row ?? null;
}
