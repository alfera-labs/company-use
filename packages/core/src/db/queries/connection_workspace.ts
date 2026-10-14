import type { Database } from '@coworker/core/db/connection';
import { connections } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';

export async function find_connection_workspace_id(
  db: Database,
  connection_id: string,
): Promise<string | null> {
  const [row] = await db
    .select({ workspace_id: connections.workspace_id })
    .from(connections)
    .where(eq(connections.connection_id, connection_id))
    .limit(1);
  return row?.workspace_id ?? null;
}
