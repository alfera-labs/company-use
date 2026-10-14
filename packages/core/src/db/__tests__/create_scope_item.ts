import type { Database } from '@coworker/core/db/connection';
import { brain_items, brain_sources } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';

export async function create_scope_item(
  db: Database,
  owner: { workspace_id: string; actor_id: string },
  scope_key: string,
) {
  const brain_source_id = create_id(id_prefixes.brain_source);
  const written_by = { created_by: owner.actor_id, last_updated_by: owner.actor_id };
  await db.insert(brain_sources).values({
    brain_source_id,
    workspace_id: owner.workspace_id,
    app_key: 'memory',
    source_name: 'memory',
    ...written_by,
  });
  await db.insert(brain_items).values({
    brain_item_id: create_id(id_prefixes.brain_item),
    workspace_id: owner.workspace_id,
    brain_source_id,
    app_key: 'memory',
    external_item_id: `scope:${scope_key}`,
    title: scope_key,
    slug: scope_key.replace(/[^a-z0-9]+/g, '-'),
    item_kind: 'scope',
    scope_key,
    ...written_by,
  });
}
