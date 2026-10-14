// No scope ordering. idx_nodes_app_name_unique allows one row per (app_id, node_name)
// across every scope, so the only question is whether this workspace may see that row.

import type { Database } from '@coworker/core/db/connection';
import { node_visibility_condition } from '@coworker/core/db/queries/catalog';
import { nodes } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

export async function get_app_action_node_key(
  db: Database,
  input: { workspace_id: string; app_id: string; node_name: string },
): Promise<string | null> {
  const [action] = await db
    .select({ node_key: nodes.node_key })
    .from(nodes)
    .where(
      and(
        eq(nodes.app_id, input.app_id),
        eq(nodes.node_name, input.node_name),
        eq(nodes.node_kind, 'action'),
        eq(nodes.node_status, 'active'),
        node_visibility_condition(input.workspace_id),
      ),
    )
    .limit(1);
  return action?.node_key ?? null;
}
