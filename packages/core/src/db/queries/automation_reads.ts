import type { Database } from '@coworker/core/db/connection';
import { automations } from '@coworker/core/db/schema';
import type {
  AutomationCreatedVia,
  AutomationStatus,
} from '@coworker/core/db/schema/automation_contracts';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

export type Automation = typeof automations.$inferSelect;

export async function get_automation(
  db: Database,
  input: { workspace_id: string; automation_id: string },
) {
  const [automation] = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        eq(automations.automation_id, input.automation_id),
      ),
    )
    .limit(1);

  return automation ?? null;
}

export async function list_automations(
  db: Database,
  input: {
    workspace_id: string;
    agent_id?: string | undefined;
    created_via?: AutomationCreatedVia | undefined;
    automation_statuses?: AutomationStatus[] | undefined;
    limit?: number | undefined;
  },
) {
  return db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        input.agent_id ? eq(automations.agent_id, input.agent_id) : undefined,
        input.created_via ? eq(automations.created_via, input.created_via) : undefined,
        input.automation_statuses
          ? inArray(automations.automation_status, input.automation_statuses)
          : ne(automations.automation_status, 'archived'),
      ),
    )
    .orderBy(desc(automations.created_time), desc(automations.automation_id))
    .limit(input.limit ?? 100);
}

export async function list_automation_workspace_ids(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ workspace_id: automations.workspace_id })
    .from(automations)
    .where(eq(automations.automation_status, 'enabled'));
  return rows.map((row) => row.workspace_id);
}

export async function list_automations_created_by_automation(
  db: Database,
  input: { workspace_id: string; parent_automation_id: string },
) {
  return db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        eq(automations.automation_status, 'enabled'),
        sql`${automations.metadata} ->> 'parent_automation_id' = ${input.parent_automation_id}`,
        sql`${automations.metadata} ->> 'expires_with_parent' = 'true'`,
      ),
    );
}
