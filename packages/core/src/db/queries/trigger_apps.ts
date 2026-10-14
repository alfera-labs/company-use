import type { Database } from '@coworker/core/db/connection';
import { apps, nodes } from '@coworker/core/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';

export type TriggerApp = {
  app_name: string;
  app_display_name: string;
  icon_url: string | null;
};

export async function list_trigger_apps_by_node_id(
  db: Database,
  node_ids: string[],
): Promise<Map<string, TriggerApp>> {
  const wanted = [...new Set(node_ids)];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({
      node_id: nodes.node_id,
      app_name: apps.app_name,
      app_display_name: apps.app_display_name,
      icon_url: sql<string | null>`coalesce(
        nullif(trim(${apps.metadata} ->> 'icon_url'), ''),
        nullif(trim(${apps.display_config} ->> 'icon_url'), '')
      )`,
    })
    .from(nodes)
    .innerJoin(apps, eq(nodes.app_id, apps.app_id))
    .where(inArray(nodes.node_id, wanted));
  return new Map(rows.map(({ node_id, ...app }) => [node_id, app]));
}
