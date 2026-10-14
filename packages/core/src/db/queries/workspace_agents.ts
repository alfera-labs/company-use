import type { Database } from '@coworker/core/db/connection';
import { agents } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

export async function find_workspace_main_agent(db: Database, workspace_id: string) {
  return (
    (await db.query.agents.findFirst({
      where: and(
        eq(agents.workspace_id, workspace_id),
        eq(agents.agent_slug, 'main'),
        eq(agents.agent_status, 'active'),
      ),
    })) ?? null
  );
}
