import type { Database } from '@coworker/core';
import {
  list_trigger_apps_by_node_id,
  type TriggerApp,
} from '@coworker/core/db/queries/trigger_apps';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';

export type TriggerWithApp = TriggerRow & { app: TriggerApp | null };

export async function attach_trigger_apps(
  db: Database,
  triggers: TriggerRow[],
): Promise<TriggerWithApp[]> {
  const node_ids = triggers.flatMap((trigger) => (trigger.node_id ? [trigger.node_id] : []));
  const app_by_node = await list_trigger_apps_by_node_id(db, node_ids);
  return triggers.map((trigger) => ({
    ...trigger,
    app: (trigger.node_id ? app_by_node.get(trigger.node_id) : undefined) ?? null,
  }));
}
