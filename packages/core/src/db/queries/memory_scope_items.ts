import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { brain_items } from '@coworker/core/db/schema';
import { and, eq, isNull, like } from 'drizzle-orm';

export type MemoryScopeItemRow = { scope_key: string; display_name: string };

export async function list_memory_scope_items_by_prefix(
  db: DatabaseExecutor,
  input: { workspace_id: string; scope_key_prefix: string },
): Promise<MemoryScopeItemRow[]> {
  const rows = await db
    .select({ scope_key: brain_items.scope_key, display_name: brain_items.title })
    .from(brain_items)
    .where(
      and(
        eq(brain_items.workspace_id, input.workspace_id),
        eq(brain_items.item_kind, 'scope'),
        isNull(brain_items.deleted_time),
        like(brain_items.scope_key, `${input.scope_key_prefix}%`),
      ),
    );
  return rows;
}

export async function find_memory_scope_item(
  db: Database,
  input: { workspace_id: string; scope_key: string },
): Promise<MemoryScopeItemRow | null> {
  const [row] = await db
    .select({ scope_key: brain_items.scope_key, display_name: brain_items.title })
    .from(brain_items)
    .where(
      and(
        eq(brain_items.workspace_id, input.workspace_id),
        eq(brain_items.item_kind, 'scope'),
        isNull(brain_items.deleted_time),
        eq(brain_items.scope_key, input.scope_key),
      ),
    )
    .limit(1);
  return row ?? null;
}
