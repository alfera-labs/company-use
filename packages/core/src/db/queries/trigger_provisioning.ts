import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { apps, nodes, triggers } from '@coworker/core/db/schema';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

// The provider delivery names the wire it came from, not our trigger. This is the one lookup
// that turns a wire id back into the trigger rows that own it — rows, plural: Composio keeps ONE
// instance per (account, event), so two automations listening to the same mailbox share one wire and
// a delivery belongs to both of them.
// Jsonb ->> filter with no index; add an expression index when deliveries per second
// make this scan show up.
export async function list_triggers_by_provisioning_key(
  db: DatabaseExecutor,
  input: { provisioned_by: string; provisioning_key: string },
) {
  return db.query.triggers.findMany({
    where: and(
      sql`${triggers.trigger_config}->>'provisioned_by' = ${input.provisioned_by}`,
      sql`${triggers.trigger_config}->>'provisioning_key' = ${input.provisioning_key}`,
    ),
  });
}

export async function count_enabled_triggers_sharing_provisioning_key(
  db: DatabaseExecutor,
  input: { provisioned_by: string; provisioning_key: string; except_trigger_id: string },
) {
  const rows = await list_triggers_by_provisioning_key(db, input);
  return rows.filter(
    (row) => row.trigger_id !== input.except_trigger_id && row.trigger_status === 'enabled',
  ).length;
}

export async function list_trigger_nodes(
  db: Database,
  input: { workspace_id: string; app_name?: string; limit?: number },
) {
  const conditions = [
    eq(nodes.node_kind, 'trigger'),
    eq(nodes.node_status, 'active'),
    or(isNull(nodes.workspace_id), eq(nodes.workspace_id, input.workspace_id)),
    ...(input.app_name ? [eq(apps.app_name, input.app_name)] : []),
  ];
  return db
    .select({
      node_id: nodes.node_id,
      node_key: nodes.node_key,
      node_display_name: nodes.node_display_name,
      runtime_handler: nodes.runtime_handler,
      app_id: nodes.app_id,
      app_name: apps.app_name,
      app_display_name: apps.app_display_name,
      app_auth_type: apps.auth_type,
      app_metadata: apps.metadata,
      app_display_config: apps.display_config,
      input_schema: nodes.input_schema,
      output_schema: nodes.output_schema,
      node_config: nodes.node_config,
      metadata: nodes.metadata,
    })
    .from(nodes)
    .innerJoin(apps, eq(nodes.app_id, apps.app_id))
    .where(and(...conditions))
    .orderBy(
      sql`case when ${nodes.runtime_handler} like 'native.trigger.%' then 0 else 1 end`,
      apps.app_name,
      nodes.node_key,
    )
    .limit(Math.min(Math.max(input.limit ?? 400, 1), 2000));
}
