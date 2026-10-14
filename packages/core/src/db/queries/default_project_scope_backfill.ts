import type { Database } from '@coworker/core/db/connection';
import { find_workspace_project } from '@coworker/core/db/queries/workspace_projects';
import { brain_items } from '@coworker/core/db/schema';
import { workspace_scope_key } from '@coworker/memory/scopes/scope_keys';
import { and, eq, isNull, ne } from 'drizzle-orm';

export type DefaultProjectScopeBackfillSummary =
  | { outcome: 'no_default_project' }
  | { outcome: 'counted'; default_project_scope_key: string; found_count: number }
  | {
      outcome: 'moved';
      default_project_scope_key: string;
      found_count: number;
      moved_count: number;
    };

async function find_items_in_default_project_scope(
  db: Database,
  input: { workspace_id: string; default_project_scope_key: string },
) {
  return db
    .select({ brain_item_id: brain_items.brain_item_id })
    .from(brain_items)
    .where(
      and(
        eq(brain_items.workspace_id, input.workspace_id),
        eq(brain_items.scope_key, input.default_project_scope_key),
        ne(brain_items.item_kind, 'scope'),
        isNull(brain_items.deleted_time),
      ),
    );
}

async function move_item_to_workspace_scope(
  db: Database,
  input: { workspace_id: string; brain_item_id: string; actor_id: string },
) {
  await db
    .update(brain_items)
    .set({
      scope_key: workspace_scope_key,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(brain_items.workspace_id, input.workspace_id),
        eq(brain_items.brain_item_id, input.brain_item_id),
      ),
    );
}

async function move_every_item_to_workspace_scope(
  db: Database,
  input: {
    workspace_id: string;
    actor_id: string;
    items: readonly { brain_item_id: string }[];
  },
): Promise<number> {
  const results = await Promise.allSettled(
    input.items.map((item) =>
      move_item_to_workspace_scope(db, {
        workspace_id: input.workspace_id,
        brain_item_id: item.brain_item_id,
        actor_id: input.actor_id,
      }),
    ),
  );
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const item = input.items[index];
    console.error(
      `could not move item ${item?.brain_item_id}, a workspace-scope item with the same slug or path may already exist`,
      result.reason,
    );
  });
  return results.filter((result) => result.status === 'fulfilled').length;
}

export async function run_default_project_scope_backfill(
  db: Database,
  input: { workspace_id: string; is_dry_run: boolean; actor_id?: string },
): Promise<DefaultProjectScopeBackfillSummary> {
  const default_project = await find_workspace_project(db, input.workspace_id);
  if (!default_project) return { outcome: 'no_default_project' };

  const default_project_scope_key = `project:${default_project.project_id}`;
  const items = await find_items_in_default_project_scope(db, {
    workspace_id: input.workspace_id,
    default_project_scope_key,
  });

  if (input.is_dry_run) {
    return { outcome: 'counted', default_project_scope_key, found_count: items.length };
  }

  const moved_count = await move_every_item_to_workspace_scope(db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id ?? 'system',
    items,
  });
  return { outcome: 'moved', default_project_scope_key, found_count: items.length, moved_count };
}
