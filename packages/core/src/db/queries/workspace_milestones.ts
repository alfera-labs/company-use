import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { not_system_provisioned } from '@coworker/core/db/queries/quest_activity_signals';
import { connections, run_messages, triggers } from '@coworker/core/db/schema';
import { and, asc, eq, ne } from 'drizzle-orm';

export async function first_user_message_time(
  db: Database,
  workspace_id: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ created_time: run_messages.created_time })
    .from(run_messages)
    .where(and(eq(run_messages.workspace_id, workspace_id), eq(run_messages.message_role, 'user')))
    .orderBy(asc(run_messages.created_time))
    .limit(1);
  return row?.created_time ?? null;
}

export async function first_tool_connection_time(
  db: Database,
  workspace_id: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ created_time: connections.created_time })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, workspace_id),
        eq(connections.connection_status, 'active'),
        ne(connections.provider_config_key, 'native:slack'),
      ),
    )
    .orderBy(asc(connections.created_time))
    .limit(1);
  return row?.created_time ?? null;
}

export async function workspace_has_slack_connection(
  db: Database,
  workspace_id: string,
): Promise<boolean> {
  const [row] = await active_slack_connections(db, workspace_id).limit(1);
  return Boolean(row);
}

export function active_slack_connections(db: DatabaseExecutor, workspace_id: string) {
  return db
    .select({ connection_id: connections.connection_id })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, workspace_id),
        eq(connections.connection_status, 'active'),
        eq(connections.provider_config_key, 'native:slack'),
      ),
    );
}

export async function first_user_scheduled_task_time(
  db: Database,
  workspace_id: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ created_time: triggers.created_time })
    .from(triggers)
    .where(
      and(
        eq(triggers.workspace_id, workspace_id),
        eq(triggers.trigger_type, 'schedule'),
        not_system_provisioned,
      ),
    )
    .orderBy(asc(triggers.created_time))
    .limit(1);
  return row?.created_time ?? null;
}
